import { createHash } from "node:crypto";
import type { AuditWriter } from "@toolflow/audit";
import { authenticateRequest, type Principal, type RequestAuthenticator } from "@toolflow/auth";
import {
  appStateInputSchema,
  catalogRefreshInputSchema,
  connectionStateInputSchema,
  inviteUserInputSchema,
  postgresConnectionInputSchema,
  toolflowErrorSchema,
  updateBrandingInputSchema,
  updateCatalogObjectInputSchema,
  updateMembershipInputSchema,
  updatePostgresConnectionInputSchema,
} from "@toolflow/contracts";
import { createRequestContext } from "@toolflow/observability";
import { roleCan } from "@toolflow/policy";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AdminStore } from "./admin-store.js";
import { ControlApiError } from "./errors.js";
import type { AuditFilters, GovernanceStore } from "./governance-store.js";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { AuthKitController } from "./authkit.js";
import type { InvitationSender } from "./workos-invitations.js";
import { InMemoryRateLimiter, type RateLimiter, type RateLimitRule } from "./rate-limit.js";

export interface AppVariables {
  principal: Principal;
  requestId: string;
}

export interface ControlApiDependencies {
  authenticator: RequestAuthenticator;
  audit: AuditWriter;
  adminStore: AdminStore;
  governanceStore?: GovernanceStore;
  allowedOrigins?: readonly string[];
  objects?: ImmutableObjectStore;
  authKit?: AuthKitController;
  invitationSender?: InvitationSender;
  rateLimiter?: RateLimiter;
}

export function createControlApi(
  dependencies: ControlApiDependencies,
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const allowedOrigins = new Set(dependencies.allowedOrigins ?? []);
  const rateLimiter = dependencies.rateLimiter ?? new InMemoryRateLimiter();

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "X-Toolflow-CSRF",
        "X-Toolflow-Dev-User-Id",
        "X-Toolflow-Dev-Membership-Id",
        "X-Toolflow-Dev-Organization-Id",
        "X-Toolflow-Dev-Role",
      ],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use("*", async (context, next) => {
    const requestContext = createRequestContext(
      context.req.header("x-request-id"),
      context.req.header("traceparent"),
    );
    context.set("requestId", requestContext.requestId);
    context.header("x-request-id", requestContext.requestId);
    context.header("x-trace-id", requestContext.traceId);
    await next();
  });

  app.use("*", async (context, next) => {
    await enforceRateLimit(context, rateLimiter, "public", requestClientKey(context.req.raw), {
      limit: 600,
      windowMs: 60_000,
    });
    await next();
  });

  app.get("/health", (context) =>
    context.json({ status: "ok", requestId: context.get("requestId") }),
  );

  if (dependencies.authKit) {
    app.get("/auth/login", () => dependencies.authKit!.login());
    app.get("/auth/callback", (context) => dependencies.authKit!.callback(context.req.raw));
    app.post("/auth/logout", (context) => dependencies.authKit!.logout(context.req.raw));
  }

  app.use("/v1/*", async (context, next) => {
    const authentication = await authenticateRequest(dependencies.authenticator, context.req.raw);
    if (!authentication) throw new HTTPException(401, { message: "Authentication required." });
    context.set("principal", authentication.principal);
    if (authentication.setCookieHeader) {
      context.header("set-cookie", authentication.setCookieHeader, { append: true });
    }
    if (
      dependencies.authKit?.hasSessionCookie(context.req.raw) &&
      context.req.method !== "GET" &&
      context.req.method !== "HEAD" &&
      context.req.method !== "OPTIONS" &&
      !dependencies.authKit.validateCsrf(context.req.raw)
    ) {
      throw new HTTPException(403, { message: "CSRF validation failed." });
    }
    const path = new URL(context.req.url).pathname;
    const actorKey = `${authentication.principal.organizationId}:${authentication.principal.userId}`;
    const isMutation = context.req.method !== "GET" && context.req.method !== "HEAD";
    await enforceRateLimit(
      context,
      rateLimiter,
      isMutation ? "actor-write" : "actor-read",
      actorKey,
      isMutation ? { limit: 120, windowMs: 60_000 } : { limit: 600, windowMs: 60_000 },
    );
    if (path === "/v1/audit/export.csv") {
      await enforceRateLimit(context, rateLimiter, "audit-export", actorKey, {
        limit: 10,
        windowMs: 60 * 60_000,
      });
    }
    await next();
  });

  app.get("/v1/csrf", (context) => {
    const token = dependencies.authKit?.csrfToken(context.req.raw);
    if (!token) throw new HTTPException(403, { message: "CSRF token is unavailable." });
    return context.json({ token, requestId: context.get("requestId") });
  });

  app.get("/v1/me", async (context) => {
    const principal = context.get("principal");
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
      ...(principal.clientId ? { clientId: principal.clientId } : {}),
      action: "identity.read",
      targetType: "membership",
      targetId: principal.membershipId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: {},
    });
    return context.json({ principal, requestId: context.get("requestId") });
  });

  app.get("/v1/overview", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Overview access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    return context.json({
      metrics: await store.getOverview(principal.organizationId),
      requestId: context.get("requestId"),
    });
  });

  app.get("/v1/users", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "User directory access is denied.");
    }
    return context.json({
      users: await dependencies.adminStore.listUsers(principal.organizationId),
      requestId: context.get("requestId"),
    });
  });

  app.post("/v1/users", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "users:manage")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "User management is restricted to admins.",
      );
    }
    const input = inviteUserInputSchema.parse(await context.req.json());
    const user = await dependencies.adminStore.inviteUser(principal.organizationId, input);
    if (dependencies.invitationSender) {
      await dependencies.invitationSender.send(principal.organizationId, user.email);
    }
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "membership.invited",
      targetType: "membership",
      targetId: user.membershipId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { email: user.email, role: user.role },
    });
    return context.json({ user, requestId: context.get("requestId") }, 201);
  });

  app.patch("/v1/users/:membershipId", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "users:manage")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "User management is restricted to admins.",
      );
    }
    const input = updateMembershipInputSchema.parse(await context.req.json());
    const user = await dependencies.adminStore.updateMembership(
      principal.organizationId,
      context.req.param("membershipId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "membership.updated",
      targetType: "membership",
      targetId: user.membershipId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { role: user.role, status: user.status },
    });
    return context.json({ user, requestId: context.get("requestId") });
  });

  app.get("/v1/branding", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Branding access is denied.");
    }
    return context.json({
      branding: await dependencies.adminStore.getBranding(principal.organizationId),
      requestId: context.get("requestId"),
    });
  });

  app.patch("/v1/branding", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "branding:manage")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "Branding changes are restricted to admins.",
      );
    }
    const input = updateBrandingInputSchema.parse(await context.req.json());
    const branding = await dependencies.adminStore.updateBranding(principal.organizationId, input);
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "branding.updated",
      targetType: "organization",
      targetId: principal.organizationId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { changedFields: Object.keys(input) },
    });
    return context.json({ branding, requestId: context.get("requestId") });
  });

  app.post("/v1/branding/logo", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "branding:manage")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "Branding changes are restricted to admins.",
      );
    }
    if (!dependencies.objects) throw new Error("Object storage is unavailable.");
    const length = Number(context.req.header("content-length") ?? 0);
    if (length > 1_000_000) {
      throw new ControlApiError(413, "VALIDATION_FAILED", "Logo exceeds 1 MB.");
    }
    const contentType = (context.req.header("content-type") ?? "").split(";")[0]!.trim();
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1_000_000) {
      throw new ControlApiError(413, "VALIDATION_FAILED", "Logo must be between 1 byte and 1 MB.");
    }
    const extension = logoExtension(contentType, bytes);
    if (!extension) {
      throw new ControlApiError(
        422,
        "VALIDATION_FAILED",
        "Logo must be a valid PNG, JPEG, or WebP image.",
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `branding/${principal.organizationId}/${hash}.${extension}`;
    await dependencies.objects.put(objectKey, bytes);
    const branding = await dependencies.adminStore.updateBranding(principal.organizationId, {
      logoObjectKey: objectKey,
    });
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "branding.logo_updated",
      targetType: "organization",
      targetId: principal.organizationId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { contentType, bytes: bytes.byteLength, objectKey },
    });
    return context.json({ branding, requestId: context.get("requestId") }, 201);
  });

  app.get("/v1/apps", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "App registry access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    return context.json({
      apps: await store.listApps(
        principal.organizationId,
        principal.role === "builder" ? principal.membershipId : undefined,
      ),
      requestId: context.get("requestId"),
    });
  });

  app.get("/v1/apps/:appId", async (context) => {
    const principal = context.get("principal");
    if (principal.role === "member") {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "App detail access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    const appId = context.req.param("appId");
    if (principal.role !== "admin") {
      const owned = await store.listApps(principal.organizationId, principal.membershipId);
      if (!owned.some((candidate) => candidate.id === appId)) {
        throw new ControlApiError(403, "AUTHORIZATION_DENIED", "App detail access is denied.");
      }
    }
    return context.json({
      app: await store.getAppDetail(principal.organizationId, appId),
      requestId: context.get("requestId"),
    });
  });

  app.get("/v1/apps/:appId/activity", async (context) => {
    const principal = context.get("principal");
    if (principal.role === "member") {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "App activity access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    const appId = context.req.param("appId");
    if (principal.role !== "admin") {
      const owned = await store.listApps(principal.organizationId, principal.membershipId);
      if (!owned.some((app) => app.id === appId)) {
        throw new ControlApiError(403, "AUTHORIZATION_DENIED", "App activity access is denied.");
      }
    }
    const window = context.req.query("window") ?? "7d";
    if (window !== "24h" && window !== "7d" && window !== "30d") {
      throw new ControlApiError(422, "VALIDATION_FAILED", "Activity window is invalid.");
    }
    const environment = context.req.query("environment");
    if (environment && environment !== "preview" && environment !== "production") {
      throw new ControlApiError(422, "VALIDATION_FAILED", "Activity environment is invalid.");
    }
    const selectedEnvironment =
      environment === "preview" || environment === "production" ? environment : undefined;
    return context.json({
      activity: await store.getAppActivity(
        principal.organizationId,
        appId,
        window,
        selectedEnvironment,
      ),
      requestId: context.get("requestId"),
    });
  });

  app.patch("/v1/apps/:appId/state", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "apps:disable")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "Emergency app controls are restricted to admins.",
      );
    }
    const input = appStateInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const app = await store.setAppState(
      principal.organizationId,
      context.req.param("appId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: input.disabled ? "app.disabled" : "app.enabled",
      targetType: "app",
      targetId: app.id,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { reason: input.reason },
    });
    return context.json({ app, requestId: context.get("requestId") });
  });

  app.get("/v1/connections", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Connection access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    return context.json({
      connections: await store.listConnections(principal.organizationId),
      requestId: context.get("requestId"),
    });
  });

  app.post("/v1/connections", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "connections:manage", "Connection management");
    const input = postgresConnectionInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const connection = await store.createConnection(principal.organizationId, input);
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "connection.created",
      targetType: "connection",
      targetId: connection.id,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { slug: connection.slug, host: connection.host, tlsMode: connection.tlsMode },
    });
    return context.json({ connection, requestId: context.get("requestId") }, 201);
  });

  app.patch("/v1/connections/:connectionId", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "connections:manage", "Connection management");
    const input = updatePostgresConnectionInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const connection = await store.updateConnection(
      principal.organizationId,
      context.req.param("connectionId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "connection.updated",
      targetType: "connection",
      targetId: connection.id,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { changedFields: Object.keys(input).filter((field) => field !== "password") },
    });
    return context.json({ connection, requestId: context.get("requestId") });
  });

  app.post("/v1/connections/:connectionId/test", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "connections:manage", "Connection management");
    const store = requireGovernanceStore(dependencies.governanceStore);
    const result = await store.testConnection(
      principal.organizationId,
      context.req.param("connectionId"),
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "connection.tested",
      targetType: "connection",
      targetId: context.req.param("connectionId"),
      requestId: context.get("requestId"),
      outcome: result.ok ? "succeeded" : "failed",
      metadata: {
        serverVersion: result.serverVersion,
        prohibitedPrivileges: result.prohibitedPrivileges,
      },
    });
    return context.json({ result, requestId: context.get("requestId") });
  });

  app.patch("/v1/connections/:connectionId/state", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "connections:manage", "Connection management");
    const input = connectionStateInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const connection = await store.setConnectionState(
      principal.organizationId,
      context.req.param("connectionId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: input.status === "disabled" ? "connection.disabled" : "connection.enabled",
      targetType: "connection",
      targetId: connection.id,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { reason: input.reason },
    });
    return context.json({ connection, requestId: context.get("requestId") });
  });

  app.delete("/v1/connections/:connectionId", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "connections:manage", "Connection management");
    const store = requireGovernanceStore(dependencies.governanceStore);
    const connectionId = context.req.param("connectionId");
    await store.removeConnection(principal.organizationId, connectionId);
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "connection.removed",
      targetType: "connection",
      targetId: connectionId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: {},
    });
    return context.body(null, 204);
  });

  app.get("/v1/catalog", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "organization:read")) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Catalog access is denied.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    return context.json({
      objects: await store.listCatalog(principal.organizationId, principal.role === "admin"),
      requestId: context.get("requestId"),
    });
  });

  app.post("/v1/connections/:connectionId/catalog-refresh", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "catalog:manage", "Catalog management");
    const input = catalogRefreshInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const result = await store.refreshCatalog(
      principal.organizationId,
      context.req.param("connectionId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: result.applied ? "catalog.refresh_applied" : "catalog.refresh_previewed",
      targetType: "connection",
      targetId: context.req.param("connectionId"),
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: {
        diffHash: result.diffHash,
        additions: result.additions,
        changes: result.changes.length,
        removals: result.removals.length,
      },
    });
    return context.json({ result, requestId: context.get("requestId") });
  });

  app.patch("/v1/catalog/:objectId", async (context) => {
    const principal = context.get("principal");
    requireAdminPermission(principal.role, "catalog:manage", "Catalog management");
    const input = updateCatalogObjectInputSchema.parse(await context.req.json());
    const store = requireGovernanceStore(dependencies.governanceStore);
    const object = await store.updateCatalogObject(
      principal.organizationId,
      context.req.param("objectId"),
      input,
    );
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "catalog.updated",
      targetType: "catalog_object",
      targetId: object.id,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: { changedFields: Object.keys(input), catalogVersion: object.catalogVersion },
    });
    return context.json({ object, requestId: context.get("requestId") });
  });

  app.get("/v1/audit", async (context) => {
    const principal = context.get("principal");
    const canReadAny = roleCan(principal.role, "audit:read:any");
    const canReadOwned = roleCan(principal.role, "audit:read:owned");
    if (!canReadAny && !canReadOwned) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Audit access is denied.");
    }
    const appId = context.req.query("appId");
    if (!canReadAny && !appId) {
      throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Builders must select an owned app.");
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    if (!canReadAny && appId) {
      const owned = await store.listApps(principal.organizationId, principal.membershipId);
      if (!owned.some((app) => app.id === appId)) {
        throw new ControlApiError(403, "AUTHORIZATION_DENIED", "Audit access is denied.");
      }
    }
    const limit = boundedInteger(context.req.query("limit"), 50, 1, 500, "limit");
    const offset = boundedInteger(context.req.query("offset"), 0, 0, 1_000_000, "offset");
    const filters = auditFiltersFromQuery((name) => context.req.query(name));
    return context.json({
      events: await store.listAudit(principal.organizationId, {
        limit,
        offset,
        ...filters,
        ...(appId ? { appId } : {}),
      }),
      pagination: { limit, offset },
      requestId: context.get("requestId"),
    });
  });

  app.get("/v1/audit/export.csv", async (context) => {
    const principal = context.get("principal");
    if (!roleCan(principal.role, "audit:read:any")) {
      throw new ControlApiError(
        403,
        "AUTHORIZATION_DENIED",
        "Organization-wide audit export is restricted to admins.",
      );
    }
    const store = requireGovernanceStore(dependencies.governanceStore);
    const filters = auditFiltersFromQuery((name) => context.req.query(name));
    const events = await store.listAudit(principal.organizationId, {
      ...filters,
      limit: 5_000,
      offset: 0,
    });
    const rows = [
      [
        "occurred_at",
        "actor_type",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "environment",
        "request_id",
        "outcome",
      ],
      ...events.map((event) => [
        event.occurredAt,
        event.actorType,
        event.actorId,
        event.action,
        event.targetType,
        event.targetId,
        event.environment ?? "",
        event.requestId,
        event.outcome,
      ]),
    ];
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      action: "audit.exported",
      targetType: "organization",
      targetId: principal.organizationId,
      requestId: context.get("requestId"),
      outcome: "succeeded",
      metadata: {
        format: "csv",
        rowCount: events.length,
        limit: 5_000,
        filters: Object.fromEntries(
          Object.entries(filters).map(([key, value]) => [
            key,
            value instanceof Date ? value.toISOString() : value,
          ]),
        ),
      },
    });
    context.header("content-type", "text/csv; charset=utf-8");
    context.header("content-disposition", 'attachment; filename="toolflow-audit.csv"');
    return context.body(rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  });

  app.onError(async (error, context) => {
    const status =
      error instanceof ControlApiError
        ? error.status
        : error instanceof ZodError
          ? 422
          : error instanceof HTTPException
            ? error.status
            : 500;
    const code =
      error instanceof ControlApiError
        ? error.code
        : error instanceof ZodError
          ? "VALIDATION_FAILED"
          : status === 401
            ? "AUTHENTICATION_REQUIRED"
            : error instanceof SyntaxError
              ? "VALIDATION_FAILED"
              : "INTERNAL_ERROR";
    const payload = toolflowErrorSchema.parse({
      code,
      message: status === 500 ? "An unexpected error occurred." : error.message,
      requestId: context.get("requestId") || createRequestContext().requestId,
      ...(error instanceof ControlApiError && error.details ? { details: error.details } : {}),
      ...(error instanceof ZodError
        ? {
            details: {
              issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          }
        : {}),
    });
    const principal = context.get("principal");
    if (principal) {
      await dependencies.audit
        .append({
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: "control.request_failed",
          targetType: "route",
          targetId: `${context.req.method} ${new URL(context.req.url).pathname}`,
          requestId: payload.requestId,
          outcome: status === 401 || status === 403 ? "denied" : "failed",
          metadata: { code, status },
        })
        .catch(() => undefined);
    }
    return context.json(payload, status);
  });

  return app;
}

function requireGovernanceStore(store: GovernanceStore | undefined): GovernanceStore {
  if (!store) throw new ControlApiError(503, "DEPENDENCY_FAILED", "Governance store unavailable.");
  return store;
}

function logoExtension(contentType: string, bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (
    contentType === "image/png" &&
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    return "png";
  if (contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (
    contentType === "image/webp" &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ControlApiError(422, "VALIDATION_FAILED", `${label} is invalid.`);
  }
  return value;
}

function auditFiltersFromQuery(
  query: (name: string) => string | undefined,
): Omit<AuditFilters, "limit" | "offset"> {
  const outcome = query("outcome");
  if (outcome && outcome !== "succeeded" && outcome !== "failed" && outcome !== "denied") {
    throw new ControlApiError(422, "VALIDATION_FAILED", "Audit outcome is invalid.");
  }
  const environment = query("environment");
  if (environment && environment !== "preview" && environment !== "production") {
    throw new ControlApiError(422, "VALIDATION_FAILED", "Audit environment is invalid.");
  }
  const from = parseAuditDate(query("from"), "from");
  const to = parseAuditDate(query("to"), "to");
  if (from && to && from > to) {
    throw new ControlApiError(422, "VALIDATION_FAILED", "Audit time range is invalid.");
  }
  const value = (name: string): string | undefined => {
    const result = query(name)?.trim();
    if (result && result.length > 255) {
      throw new ControlApiError(422, "VALIDATION_FAILED", `${name} is too long.`);
    }
    return result || undefined;
  };
  const filters: Omit<AuditFilters, "limit" | "offset"> = {};
  const values = {
    action: value("action"),
    actor: value("actor"),
    actorId: value("actorId"),
    actorType: value("actorType"),
    target: value("target"),
    targetType: value("targetType"),
    appId: value("appId"),
    requestId: value("requestId"),
  };
  for (const [key, candidate] of Object.entries(values)) {
    if (candidate) Object.assign(filters, { [key]: candidate });
  }
  if (outcome) filters.outcome = outcome as NonNullable<AuditFilters["outcome"]>;
  if (environment) {
    filters.environment = environment as NonNullable<AuditFilters["environment"]>;
  }
  if (from) filters.from = from;
  if (to) filters.to = to;
  return filters;
}

function parseAuditDate(raw: string | undefined, label: string): Date | undefined {
  if (!raw) return undefined;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ControlApiError(422, "VALIDATION_FAILED", `Audit ${label} time is invalid.`);
  }
  return value;
}

function requireAdminPermission(
  role: Principal["role"],
  permission: Parameters<typeof roleCan>[1],
  label: string,
): void {
  if (!roleCan(role, permission)) {
    throw new ControlApiError(403, "AUTHORIZATION_DENIED", `${label} is restricted to admins.`);
  }
}

async function enforceRateLimit(
  context: { header(name: string, value: string): void },
  limiter: RateLimiter,
  scope: string,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const decision = await limiter.consume(scope, key, rule);
  context.header("x-ratelimit-remaining", String(decision.remaining));
  if (!decision.allowed) {
    context.header("retry-after", String(decision.retryAfterSeconds));
    throw new ControlApiError(429, "RATE_LIMITED", "Request rate limit exceeded.", {
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
}

function requestClientKey(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  return forwarded?.trim() || "unresolved-client";
}
