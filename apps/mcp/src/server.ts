import type { AuditWriter } from "@toolflow/audit";
import { AppDataError, type AppSchemaService } from "@toolflow/app-data";
import type { BuildService } from "@toolflow/build-system";
import {
  LifecycleError,
  type DeploymentService,
  type ProductionDeploymentService,
} from "@toolflow/lifecycle";
import { McpServer, type CallToolResult, type ToolCallback } from "@modelcontextprotocol/server";
import type { AuthenticatedMcpPrincipal } from "./oauth-verifier.js";
import { McpServiceError } from "./source-service.js";
import type { ToolflowSourceService } from "./source-service.js";
import { idempotencyRecords, type ToolflowDatabase } from "@toolflow/database";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";

const pageInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(50),
});
const pageOutput = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable(),
  version: z.string(),
});
const objectOutput = z.object({ result: z.record(z.string(), z.unknown()) });

export interface ToolflowMcpServerDependencies {
  service: ToolflowSourceService;
  buildService: BuildService;
  deploymentService: DeploymentService;
  schemaService: AppSchemaService;
  productionService: ProductionDeploymentService;
  audit: AuditWriter;
  database: ToolflowDatabase["db"];
}

export function createToolflowMcpServer(
  principal: AuthenticatedMcpPrincipal,
  dependencies: ToolflowMcpServerDependencies,
): McpServer {
  const server = new McpServer({ name: "Toolflow", version: "0.1.0" });

  async function auditAction(
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
    environment?: "preview" | "production",
  ) {
    await dependencies.audit.append({
      organizationId: principal.organizationId,
      actorType: "user",
      actorId: principal.userId,
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
      ...(principal.clientId ? { clientId: principal.clientId } : {}),
      action,
      targetType,
      targetId,
      ...(environment ? { environment } : {}),
      requestId: crypto.randomUUID(),
      outcome: "succeeded",
      metadata,
    });
  }

  async function idempotentMutation(
    operation: string,
    input: Record<string, unknown>,
    handler: () => Promise<unknown>,
  ) {
    const key = input.idempotencyKey;
    if (typeof key !== "string" || key.length < 8) {
      throw new McpServiceError(
        "VALIDATION_FAILED",
        `${operation} requires an idempotency key of at least 8 characters.`,
      );
    }
    const requestHash = createHash("sha256").update(stableJson(input)).digest("hex");
    const recordOperation = `mcp.${operation}`;
    const scope = `${principal.organizationId}:${principal.userId}:${recordOperation}:${key}`;
    return dependencies.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
      const rows = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.organizationId, principal.organizationId),
            eq(idempotencyRecords.actorId, principal.userId),
            eq(idempotencyRecords.operation, recordOperation),
            eq(idempotencyRecords.key, key),
          ),
        )
        .limit(1);
      const record = rows[0];
      if (record) {
        if (record.requestHash !== requestHash) {
          throw new McpServiceError("CONFLICT", "Idempotency key was used with another request.");
        }
        return record.response;
      }
      const result = await handler();
      await transaction
        .insert(idempotencyRecords)
        .values({
          organizationId: principal.organizationId,
          actorId: principal.userId,
          operation: recordOperation,
          key,
          requestHash,
          statusCode: 200,
          response: result,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        })
        .onConflictDoNothing();
      return result;
    });
  }

  function register<I extends z.ZodObject<z.ZodRawShape>, O extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    description: string,
    scope: string,
    inputSchema: I,
    outputSchema: O,
    handler: (input: z.infer<I>) => Promise<unknown>,
  ) {
    const mutation =
      /^(?:create|update|validate|plan|apply|request|approve|reject|deploy|grant|revoke|rollback|disable)_/.test(
        name,
      );
    const callback = (async (input: unknown): Promise<CallToolResult> => {
      const startedAt = performance.now();
      let outcome: "succeeded" | "failed" | "denied" = "succeeded";
      try {
        if (!principal.scopes.includes(scope)) {
          outcome = "denied";
          throw new McpServiceError(
            "AUTHORIZATION_DENIED",
            `${name} requires the ${scope} OAuth scope.`,
          );
        }
        const parsedInput = input as z.infer<I>;
        const result = mutation
          ? await idempotentMutation(name, parsedInput, () => handler(parsedInput))
          : await handler(parsedInput);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        if (outcome !== "denied") {
          outcome =
            (error instanceof McpServiceError ||
              error instanceof LifecycleError ||
              error instanceof AppDataError) &&
            error.code === "AUTHORIZATION_DENIED"
              ? "denied"
              : "failed";
        }
        const code =
          error instanceof McpServiceError ||
          error instanceof LifecycleError ||
          error instanceof AppDataError
            ? error.code
            : "INTERNAL_ERROR";
        const message =
          error instanceof McpServiceError ||
          error instanceof LifecycleError ||
          error instanceof AppDataError
            ? error.message
            : "An unexpected error occurred.";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code,
                message,
                ...((error instanceof McpServiceError ||
                  error instanceof LifecycleError ||
                  error instanceof AppDataError) &&
                error.details
                  ? { details: error.details }
                  : {}),
              }),
            },
          ],
        };
      } finally {
        await dependencies.audit.append({
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
          ...(principal.clientId ? { clientId: principal.clientId } : {}),
          action: `mcp.${name}`,
          targetType: "mcp_tool",
          targetId: name,
          requestId: crypto.randomUUID(),
          outcome,
          metadata: {
            tool: name,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
      }
    }) as ToolCallback<I>;
    server.registerTool(
      name,
      {
        title: name
          .split("_")
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join(" "),
        description,
        inputSchema,
        outputSchema,
        annotations: {
          readOnlyHint: !mutation,
          destructiveHint: /^(?:reject|revoke|rollback|disable)_/.test(name),
          idempotentHint: mutation,
          openWorldHint: false,
        },
        _meta: {
          requiredScopes: ["toolflow:mcp", scope],
          errorCodes: [
            "AUTHENTICATION_FAILED",
            "AUTHORIZATION_DENIED",
            "CONFLICT",
            "VALIDATION_FAILED",
            "NOT_FOUND",
            "RATE_LIMITED",
            "DEPENDENCY_FAILED",
            "INTERNAL_ERROR",
          ],
        },
      },
      callback,
    );
  }

  register(
    "get_current_user",
    "Return the authenticated Toolflow user, selected organization, role, and granted scopes.",
    "toolflow:read",
    z.object({}),
    objectOutput,
    async () => ({ result: await dependencies.service.currentUser(principal) }),
  );

  register(
    "list_organization_users",
    "List organization users that may own or access an internal app. Results are paginated.",
    "toolflow:read",
    pageInput,
    pageOutput,
    async ({ cursor, limit }) => {
      const offset = decodeCursor(cursor);
      const users = await dependencies.service.listUsers(principal, offset, limit);
      return page(users, offset, limit);
    },
  );

  register(
    "get_organization_branding",
    "Return normalized accessible branding tokens and written design guidance for generated apps.",
    "toolflow:read",
    z.object({}),
    objectOutput,
    async () => ({ result: await dependencies.service.branding(principal) }),
  );

  register(
    "search_apps",
    "Search the organization app registry before creating a new tool to avoid duplicates.",
    "toolflow:read",
    pageInput.extend({
      query: z.string().max(200).default(""),
      ownerMembershipId: z.uuid().optional(),
      lifecycle: z
        .enum(["draft", "preview", "production", "disabled", "orphaned", "archived"])
        .optional(),
      dataObject: z.string().max(200).optional(),
    }),
    pageOutput,
    async ({ query, cursor, limit, ownerMembershipId, lifecycle, dataObject }) => {
      const offset = decodeCursor(cursor);
      const apps = await dependencies.service.searchApps(principal, query, offset, limit, {
        ...(ownerMembershipId ? { ownerMembershipId } : {}),
        ...(lifecycle ? { lifecycle } : {}),
        ...(dataObject ? { dataObject } : {}),
      });
      return page(apps, offset, limit);
    },
  );

  register(
    "get_app",
    "Return one app, its current immutable source version, and optionally its editable source file list. Source requires edit permission.",
    "toolflow:read",
    z.object({ appId: z.uuid(), includeSource: z.boolean().default(false) }),
    objectOutput,
    async ({ appId, includeSource }) => ({
      result: await dependencies.service.getApp(principal, appId, includeSource),
    }),
  );

  register(
    "list_app_files",
    "List the UTF-8 text files in the current immutable source version of an owned app.",
    "toolflow:read",
    pageInput.extend({ appId: z.uuid() }),
    pageOutput,
    async ({ appId, cursor, limit }) => {
      const offset = decodeCursor(cursor);
      const app = await dependencies.service.getApp(principal, appId, true);
      const files = (app.files ?? []).slice(offset, offset + limit);
      return page(files, offset, limit);
    },
  );

  register(
    "read_app_file",
    "Read one UTF-8 text file from a current or historical source version of an owned app.",
    "toolflow:read",
    z.object({ appId: z.uuid(), path: z.string().min(1).max(512), versionId: z.uuid().optional() }),
    objectOutput,
    async ({ appId, path, versionId }) => ({
      result: await dependencies.service.readAppFile(principal, appId, path, versionId),
    }),
  );

  register(
    "list_app_members",
    "List the explicitly granted organization members and owners of an app.",
    "toolflow:read",
    pageInput.extend({ appId: z.uuid() }),
    pageOutput,
    async ({ appId, cursor, limit }) => {
      const offset = decodeCursor(cursor);
      return page(
        await dependencies.service.listAppMembers(principal, appId, offset, limit),
        offset,
        limit,
      );
    },
  );

  register(
    "grant_app_access",
    "Grant an active organization member access to an app. Admins and app owners may grant access.",
    "toolflow:write",
    z.object({
      appId: z.uuid(),
      membershipId: z.uuid(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => {
      const result = await dependencies.service.grantAppAccess(principal, input);
      await dependencies.audit.append({
        organizationId: principal.organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "app.access_granted",
        targetType: "app",
        targetId: input.appId,
        requestId: crypto.randomUUID(),
        outcome: "succeeded",
        metadata: { membershipId: input.membershipId },
      });
      return { result };
    },
  );

  register(
    "revoke_app_access",
    "Revoke a non-owner's app access. Revocation is enforced by the dispatcher on the next request.",
    "toolflow:write",
    z.object({
      appId: z.uuid(),
      membershipId: z.uuid(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => {
      const result = await dependencies.service.revokeAppAccess(principal, input);
      await dependencies.audit.append({
        organizationId: principal.organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "app.access_revoked",
        targetType: "app",
        targetId: input.appId,
        requestId: crypto.randomUUID(),
        outcome: "succeeded",
        metadata: { membershipId: input.membershipId },
      });
      return { result };
    },
  );

  register(
    "list_data_connections",
    "List safe metadata for available data connections. Credentials and connection URIs are never returned.",
    "toolflow:read",
    pageInput,
    pageOutput,
    async ({ cursor, limit }) => {
      const offset = decodeCursor(cursor);
      const connections = await dependencies.service.listConnections(principal, offset, limit);
      return page(connections, offset, limit);
    },
  );

  register(
    "search_data_catalog",
    "Search approved active or deprecated schemas, tables, and columns without returning data rows.",
    "toolflow:read",
    pageInput.extend({ query: z.string().max(200).default("") }),
    pageOutput,
    async ({ query, cursor, limit }) => {
      const offset = decodeCursor(cursor);
      const objects = await dependencies.service.searchCatalog(principal, query, offset, limit);
      return page(objects, offset, limit);
    },
  );

  register(
    "get_schema_context",
    "Look up exact approved schema context for a table or field, including lifecycle warnings and ownership annotations.",
    "toolflow:read",
    z.object({ query: z.string().min(1).max(200) }),
    objectOutput,
    async ({ query }) => ({
      result: {
        objects: await dependencies.service.searchCatalog(principal, query, 0, 50),
        query,
      },
    }),
  );

  register(
    "create_app",
    "Create a governed draft app from Toolflow's fixed React, TypeScript, Vite, Hono, component, and SDK template.",
    "toolflow:write",
    z.object({
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().min(1).max(120),
      description: z.string().max(2_000),
      ownerMembershipId: z.uuid(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => ({ result: await dependencies.service.createApp(principal, input) }),
  );

  register(
    "update_app_files",
    "Create, update, or delete permitted UTF-8 source files using optimistic concurrency. Every successful mutation creates an immutable source version.",
    "toolflow:write",
    z.object({
      appId: z.uuid(),
      baseVersionId: z.uuid(),
      files: z
        .array(z.object({ path: z.string().min(1).max(512), content: z.string().max(2_000_000) }))
        .max(100),
      deletedPaths: z.array(z.string().min(1).max(512)).max(100).default([]),
      message: z.string().min(1).max(500),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => ({ result: await dependencies.service.updateFiles(principal, input) }),
  );

  register(
    "validate_app",
    "Validate and deterministically build the current immutable source version with Toolflow's pinned runtime.",
    "toolflow:write",
    z.object({
      appId: z.uuid(),
      sourceVersionId: z.uuid().optional(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async ({ appId, sourceVersionId }) => {
      const app = await dependencies.service.getApp(principal, appId, true);
      const current = app.currentSourceVersion as { id: string };
      if (sourceVersionId && sourceVersionId !== current.id) {
        throw new McpServiceError(
          "CONFLICT",
          "Validation currently requires the app's current source version.",
          { latestVersionId: current.id },
        );
      }
      const build = await dependencies.buildService.build(
        principal.organizationId,
        appId,
        sourceVersionId ?? current.id,
      );
      return {
        result: {
          id: build.id,
          status: build.status,
          sourceVersionId: build.sourceVersionId,
          runtimeVersionId: build.runtimeVersionId,
          artifactHash: build.artifactHash,
          diagnostics: build.diagnostics,
          startedAt: build.startedAt?.toISOString() ?? null,
          completedAt: build.completedAt?.toISOString() ?? null,
        },
      };
    },
  );

  register(
    "create_preview",
    "Deploy a successful immutable build to an authenticated preview with isolated app data. No admin approval is required.",
    "toolflow:deploy",
    z.object({
      appId: z.uuid(),
      buildId: z.uuid(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => {
      const result = await dependencies.deploymentService.createPreview(principal, input);
      await auditAction(
        "deployment.preview_created",
        "deployment",
        result.id,
        { appId: result.appId, buildId: input.buildId, artifactHash: result.artifactHash },
        "preview",
      );
      return { result };
    },
  );

  register(
    "plan_app_schema_change",
    "Create a typed additive-only schema plan for app-owned data. Raw SQL and destructive changes are rejected.",
    "toolflow:write",
    z.object({
      appId: z.uuid(),
      sourceVersionId: z.uuid().optional(),
      environment: z.enum(["preview", "production"]).default("preview"),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async ({ appId, sourceVersionId, environment }) => ({
      result: await dependencies.schemaService.plan(principal, {
        appId,
        environment,
        ...(sourceVersionId ? { sourceVersionId } : {}),
      }),
    }),
  );

  register(
    "apply_preview_schema_change",
    "Apply an immutable additive schema plan to the isolated preview data space. Production plans are derived and applied automatically during deployment.",
    "toolflow:deploy",
    z.object({ planId: z.uuid(), idempotencyKey: z.string().min(8).max(255) }),
    objectOutput,
    async ({ planId }) => {
      const result = await dependencies.schemaService.applyPreview(principal, planId);
      await auditAction(
        "schema.preview_applied",
        "schema_plan",
        planId,
        { appId: result.appId, planHash: result.hash, replayed: result.replayed },
        "preview",
      );
      return { result };
    },
  );

  register(
    "get_deployment_status",
    "Return recent preview and production deployment attempts for an owned app.",
    "toolflow:read",
    z.object({ appId: z.uuid() }),
    objectOutput,
    async ({ appId }) => ({
      result: { deployments: await dependencies.deploymentService.status(principal, appId) },
    }),
  );

  register(
    "get_app_activity",
    "Return redacted aggregate usage, error, latency, external-query, and managed-write metrics for an owned app.",
    "toolflow:read",
    z.object({
      appId: z.uuid(),
      window: z.enum(["24h", "7d", "30d"]).default("7d"),
      environment: z.enum(["preview", "production"]).optional(),
    }),
    objectOutput,
    async ({ appId, window, environment }) => ({
      result: await dependencies.service.appActivity(principal, appId, window, environment),
    }),
  );

  register(
    "deploy_to_production",
    "Publish an exact successfully previewed build to the stable authenticated production URL. Toolflow automatically validates and applies additive managed-schema changes and enforces current catalog guardrails before atomic activation.",
    "toolflow:deploy",
    z.object({
      appId: z.uuid(),
      buildId: z.uuid(),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async ({ appId, buildId, idempotencyKey }) => {
      const result = await dependencies.productionService.deploy(principal, {
        appId,
        buildId,
        idempotencyKey,
      });
      await auditAction(
        "production.deployed",
        "deployment",
        (result as { id: string }).id,
        {
          appId,
          buildId,
          schemaPlanId: (result as { schemaPlanId?: string | null }).schemaPlanId,
          artifactHash: (result as { artifactHash?: string }).artifactHash,
        },
        "production",
      );
      return { result };
    },
  );

  register(
    "rollback_app",
    "Restore a previously successful production artifact whose capabilities remain within current catalog guardrails, without reversing additive schema changes.",
    "toolflow:deploy",
    z.object({
      appId: z.uuid(),
      targetDeploymentId: z.uuid(),
      reason: z.string().min(3).max(2_000),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async ({ appId, targetDeploymentId, reason, idempotencyKey }) => {
      const result = await dependencies.productionService.rollback(principal, {
        appId,
        targetDeploymentId,
        reason,
        idempotencyKey,
      });
      await auditAction(
        "rollback.succeeded",
        "app",
        appId,
        {
          targetDeploymentId,
          reason,
        },
        "production",
      );
      return { result };
    },
  );

  register(
    "disable_app",
    "Immediately disable or re-enable an app as an organization admin. The exact app name and an incident reason are required; source, deployments, data, and audit history are retained.",
    "toolflow:deploy",
    z.object({
      appId: z.uuid(),
      disabled: z.boolean(),
      reason: z.string().trim().min(3).max(1_000),
      confirmationName: z.string().trim().min(1),
      idempotencyKey: z.string().min(8).max(255),
    }),
    objectOutput,
    async (input) => {
      const result = await dependencies.service.setAppState(principal, input);
      await auditAction(input.disabled ? "app.disabled" : "app.enabled", "app", input.appId, {
        reason: input.reason,
      });
      return { result };
    },
  );

  return server;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid cursor.");
    return value;
  } catch {
    throw new McpServiceError("VALIDATION_FAILED", "Pagination cursor is invalid.");
  }
}

function page(items: object[], offset: number, limit: number) {
  return {
    items,
    nextCursor:
      items.length === limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
    version: new Date().toISOString(),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
import { createHash } from "node:crypto";
