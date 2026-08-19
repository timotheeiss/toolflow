import type { AuditWriter } from "@toolflow/audit";
import { accessibleForeground } from "@toolflow/contracts";
import { authenticateRequest, type Principal, type RequestAuthenticator } from "@toolflow/auth";
import type { ToolflowArtifact } from "@toolflow/build-system";
import {
  activeDeployments,
  appMembers,
  appRoutes,
  apps,
  builds,
  deployments,
  organizationBranding,
  organizationMemberships,
  usageEvents,
  users,
  and,
  eq,
  type ToolflowDatabase,
} from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { RuntimeContextSigner } from "@toolflow/runtime-context";
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";

interface RuntimeDependencies {
  database: ToolflowDatabase["db"];
  objects: ImmutableObjectStore;
  authenticator: RequestAuthenticator;
  audit: AuditWriter;
  runtimeContextSigner: RuntimeContextSigner;
  dataGatewayUrl: string;
  authorizationServiceToken?: string;
}

export interface RuntimeVariables {
  principal: Principal;
  requestId: string;
  traceId: string;
}

export function createRuntimeDispatcher(dependencies: RuntimeDependencies) {
  const app = new Hono<{ Variables: RuntimeVariables }>();
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.post("/internal/authorize-runtime", async (context) => {
    if (
      !dependencies.authorizationServiceToken ||
      !constantEqual(
        context.req.header("x-toolflow-service-authorization") ?? "",
        dependencies.authorizationServiceToken,
      )
    ) {
      return context.json({ message: "Access denied." }, 401);
    }
    const userHeaders = new Headers(context.req.raw.headers);
    userHeaders.delete("x-toolflow-service-authorization");
    const authentication = await authenticateRequest(
      dependencies.authenticator,
      new Request(context.req.raw, { headers: userHeaders }),
    );
    if (!authentication) return context.json({ message: "Access denied." }, 403);
    const principal = authentication.principal;
    const routeKey = context.req.header("x-toolflow-route-key") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(routeKey)) {
      return context.json({ message: "Access denied." }, 403);
    }
    const [row] = await dependencies.database
      .select({
        route: appRoutes,
        app: apps,
        deployment: deployments,
        userName: users.name,
        userEmail: users.email,
      })
      .from(appRoutes)
      .innerJoin(apps, eq(apps.id, appRoutes.appId))
      .innerJoin(appMembers, eq(appMembers.appId, apps.id))
      .innerJoin(organizationMemberships, eq(organizationMemberships.id, appMembers.membershipId))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(activeDeployments, eq(activeDeployments.appId, apps.id))
      .innerJoin(deployments, eq(deployments.id, activeDeployments.deploymentId))
      .where(
        and(
          eq(apps.organizationId, principal.organizationId),
          eq(appRoutes.routeKey, routeKey),
          eq(appRoutes.organizationId, principal.organizationId),
          eq(appMembers.membershipId, principal.membershipId),
          eq(organizationMemberships.status, "active"),
          eq(activeDeployments.environment, appRoutes.environment),
          eq(deployments.environment, appRoutes.environment),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    if (!row || row.app.lifecycle === "disabled")
      return context.json({ message: "Access denied." }, 403);
    const organizationId = row.route.organizationId;
    const environment = row.route.environment;
    const requestId = crypto.randomUUID();
    const traceId = createTraceId();
    const hashedActor = await actorHash(principal.userId, organizationId);
    const runtimeContextToken = await dependencies.runtimeContextSigner.sign({
      organizationId,
      appId: row.app.id,
      deploymentId: row.deployment.id,
      userId: principal.userId,
      membershipId: principal.membershipId,
      environment,
      requestId,
      traceId,
    });
    await dependencies.audit.append({
      organizationId,
      actorType: "user",
      actorId: principal.userId,
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
      action: "app.access_granted",
      targetType: "app",
      targetId: row.app.id,
      environment,
      requestId,
      outcome: "succeeded",
      metadata: { deploymentId: row.deployment.id, traceId },
    });
    return context.json({
      allowed: true,
      scriptName: `tf-${environment}-${row.deployment.id}`,
      routeKey,
      organizationId,
      appId: row.app.id,
      deploymentId: row.deployment.id,
      environment,
      requestId,
      traceId,
      actorHash: hashedActor,
      runtimeContextToken,
      publicContext: {
        userId: principal.userId,
        name: row.userName,
        email: row.userEmail,
        appId: row.app.id,
        environment,
        dataPath: "/__toolflow/data",
      },
    });
  });
  app.post("/internal/runtime-usage", async (context) => {
    if (
      !dependencies.authorizationServiceToken ||
      !constantEqual(
        context.req.header("x-toolflow-service-authorization") ?? "",
        dependencies.authorizationServiceToken,
      )
    ) {
      return context.json({ message: "Access denied." }, 401);
    }
    const body = await context.req.text();
    if (Buffer.byteLength(body) > 8_192)
      return context.json({ message: "Invalid usage event." }, 413);
    const event = parseRuntimeUsage(body);
    if (!event) return context.json({ message: "Invalid usage event." }, 422);
    const [deployment] = await dependencies.database
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.id, event.deploymentId),
          eq(deployments.organizationId, event.organizationId),
          eq(deployments.appId, event.appId),
          eq(deployments.environment, event.environment),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    if (!deployment) return context.json({ message: "Invalid usage event." }, 422);
    await dependencies.database.insert(usageEvents).values({
      organizationId: event.organizationId,
      appId: event.appId,
      deploymentId: event.deploymentId,
      environment: event.environment,
      eventType: "app.request",
      actorHash: event.actorHash,
      requestId: event.requestId,
      traceId: event.traceId,
      durationMs: event.durationMs,
      outcome: event.status >= 200 && event.status < 400 ? "succeeded" : "failed",
      dimensions: { status: event.status },
    });
    return new Response(null, { status: 204 });
  });
  app.use("/apps/*", async (context, next) => {
    const authentication = await authenticateRequest(dependencies.authenticator, context.req.raw);
    if (!authentication) return context.json({ message: "Access denied." }, 401);
    context.set("principal", authentication.principal);
    if (authentication.setCookieHeader) {
      context.header("set-cookie", authentication.setCookieHeader, { append: true });
    }
    context.set("requestId", crypto.randomUUID());
    context.set("traceId", createTraceId());
    await next();
  });
  app.all("/apps/:organizationId/:appSlug/:environment/*", async (context) => {
    const started = performance.now();
    const principal = context.get("principal");
    const organizationId = context.req.param("organizationId");
    const appSlug = context.req.param("appSlug");
    const environment = context.req.param("environment");
    if (
      organizationId !== principal.organizationId ||
      (environment !== "preview" && environment !== "production")
    ) {
      await dependencies.audit.append({
        organizationId: principal.organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "app.access_denied",
        targetType: "app_route",
        targetId: "unresolved",
        requestId: context.get("requestId"),
        outcome: "denied",
        metadata: { reason: "route_scope_mismatch" },
      });
      return context.json({ message: "App not found." }, 404);
    }
    const rows = await dependencies.database
      .select({
        app: apps,
        deployment: deployments,
        artifactObjectKey: builds.artifactObjectKey,
        branding: organizationBranding,
        userName: users.name,
        userEmail: users.email,
      })
      .from(apps)
      .innerJoin(appMembers, eq(appMembers.appId, apps.id))
      .innerJoin(organizationMemberships, eq(organizationMemberships.id, appMembers.membershipId))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(activeDeployments, eq(activeDeployments.appId, apps.id))
      .innerJoin(deployments, eq(deployments.id, activeDeployments.deploymentId))
      .innerJoin(builds, eq(builds.id, deployments.buildId))
      .innerJoin(organizationBranding, eq(organizationBranding.organizationId, apps.organizationId))
      .where(
        and(
          eq(apps.organizationId, organizationId),
          eq(apps.slug, appSlug),
          eq(appMembers.membershipId, principal.membershipId),
          eq(organizationMemberships.status, "active"),
          eq(activeDeployments.environment, environment),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      await dependencies.audit.append({
        organizationId: principal.organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "app.access_denied",
        targetType: "app_route",
        targetId: appSlug,
        environment,
        requestId: context.get("requestId"),
        outcome: "denied",
        metadata: { reason: "membership_or_deployment" },
      });
      return context.json({ message: "App not found." }, 404);
    }
    if (row.app.lifecycle === "disabled") {
      await dependencies.audit.append({
        organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "app.access_denied_disabled",
        targetType: "app",
        targetId: row.app.id,
        environment,
        requestId: context.get("requestId"),
        outcome: "denied",
        metadata: {},
      });
      return context.json({ message: "This app is temporarily unavailable." }, 503);
    }
    if (!row.artifactObjectKey) return context.json({ message: "App artifact unavailable." }, 503);
    const artifact = JSON.parse(
      new TextDecoder().decode(await dependencies.objects.get(row.artifactObjectKey)),
    ) as ToolflowArtifact;
    const path = new URL(context.req.url).pathname.split(`/${environment}/`)[1] ?? "";
    let response: Response;
    if (path.startsWith("__toolflow/data/")) {
      const gatewayPath = path.slice("__toolflow/data/".length);
      const allowedGatewayPaths = new Set([
        "external-query",
        "managed/create",
        "managed/list",
        "managed/update",
        "managed/delete",
      ]);
      if (!allowedGatewayPaths.has(gatewayPath) || context.req.method !== "POST") {
        response = Response.json({ message: "Not found." }, { status: 404 });
      } else {
        const body = await context.req.text();
        if (Buffer.byteLength(body) > 1_000_000) {
          response = Response.json({ message: "Request body exceeds 1 MB." }, { status: 413 });
        } else {
          const token = await dependencies.runtimeContextSigner.sign({
            organizationId,
            appId: row.app.id,
            deploymentId: row.deployment.id,
            userId: principal.userId,
            membershipId: principal.membershipId,
            environment,
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          });
          const gatewayResponse = await fetch(
            new URL(`/v1/${gatewayPath}`, dependencies.dataGatewayUrl),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "x-request-id": context.get("requestId"),
              },
              body,
            },
          );
          response = new Response(gatewayResponse.body, {
            status: gatewayResponse.status,
            headers: {
              "content-type": gatewayResponse.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        }
      }
    } else if (path === "artifact.js") {
      response = new Response(artifact.clientJavaScript, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    } else if (path === "artifact.css") {
      response = new Response(`${brandingCss(row.branding.primaryColor)}\n${artifact.clientCss}`, {
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    } else if (path === "api/health") {
      response = Response.json({ status: "ok", deploymentId: row.deployment.id });
    } else if (path === "" || path === "index.html") {
      const runtimeContext = JSON.stringify({
        userId: principal.userId,
        name: row.userName,
        email: row.userEmail,
        appId: row.app.id,
        environment,
        dataPath: `/apps/${organizationId}/${appSlug}/${environment}/__toolflow/data`,
      });
      const banner =
        environment === "preview"
          ? '<div class="tf-preview-banner">Preview environment · isolated test data</div>'
          : "";
      const html = artifact.html
        .replace(
          "<head>",
          `<head><base href="/apps/${organizationId}/${appSlug}/${environment}/"><script>window.__TOOLFLOW_CONTEXT__=${runtimeContext.replaceAll("<", "\\u003c")}</script>`,
        )
        .replace("<body>", `<body>${banner}`);
      response = new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; worker-src 'none'; child-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    } else {
      response = Response.json({ message: "Not found." }, { status: 404 });
    }
    const durationMs = Math.round(performance.now() - started);
    await dependencies.database.insert(usageEvents).values({
      organizationId,
      appId: row.app.id,
      deploymentId: row.deployment.id,
      environment,
      eventType: "app.request",
      actorHash: await actorHash(principal.userId, organizationId),
      requestId: context.get("requestId"),
      traceId: context.get("traceId"),
      durationMs,
      outcome: response.ok ? "succeeded" : "failed",
      dimensions: { status: response.status, route: path || "index" },
    });
    response.headers.set("x-request-id", context.get("requestId"));
    response.headers.set("x-trace-id", context.get("traceId"));
    return response;
  });
  return app;
}

export function brandingCss(primary: string) {
  return `:root{--tf-primary:${primary};--tf-on-primary:${accessibleForeground(primary)};--tf-bg:#f7f8f5;--tf-fg:#17231f;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--tf-fg);background:var(--tf-bg)}body{margin:0}.tf-shell{min-height:100vh}.tf-header{display:flex;align-items:center;gap:10px;padding:16px 24px;border-bottom:1px solid #dfe4df;background:#fff}.tf-mark{display:grid;width:28px;height:28px;place-items:center;border-radius:8px;color:var(--tf-on-primary);background:var(--tf-primary);font-weight:800}.tf-main{max-width:1100px;margin:auto;padding:40px 24px}.tf-preview-banner{padding:8px 16px;color:#6c5420;background:#fff1b8;text-align:center;font-size:12px;font-weight:700}.tf-button{padding:9px 14px;border:0;border-radius:8px;color:var(--tf-on-primary);background:var(--tf-primary)}.tf-table-wrap{overflow:auto}.tf-table{width:100%;border-collapse:collapse}`;
}

async function actorHash(userId: string, organizationId: string) {
  const bytes = new TextEncoder().encode(`${organizationId}:${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function createTraceId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

interface RuntimeUsageEvent {
  organizationId: string;
  appId: string;
  deploymentId: string;
  environment: "preview" | "production";
  requestId: string;
  traceId: string;
  actorHash: string;
  status: number;
  durationMs: number;
}

function parseRuntimeUsage(body: string): RuntimeUsageEvent | null {
  try {
    const value = JSON.parse(body) as Partial<RuntimeUsageEvent>;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (
      typeof value.organizationId !== "string" ||
      !uuid.test(value.organizationId) ||
      typeof value.appId !== "string" ||
      !uuid.test(value.appId) ||
      typeof value.deploymentId !== "string" ||
      !uuid.test(value.deploymentId) ||
      (value.environment !== "preview" && value.environment !== "production") ||
      typeof value.requestId !== "string" ||
      value.requestId.length < 1 ||
      value.requestId.length > 255 ||
      typeof value.traceId !== "string" ||
      !/^[0-9a-f]{32}$/.test(value.traceId) ||
      typeof value.actorHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.actorHash) ||
      typeof value.status !== "number" ||
      !Number.isInteger(value.status) ||
      value.status < 100 ||
      value.status > 599 ||
      typeof value.durationMs !== "number" ||
      !Number.isInteger(value.durationMs) ||
      value.durationMs < 0 ||
      value.durationMs > 300_000
    ) {
      return null;
    }
    return value as RuntimeUsageEvent;
  } catch {
    return null;
  }
}
