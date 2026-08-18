import type { AuditWriter } from "@toolflow/audit";
import {
  appManifestSchema,
  appCapabilitySchema,
  type AppCapability,
  type AppManifest,
} from "@toolflow/contracts";
import { authorizeExternalRead, SqlPolicyError } from "@toolflow/data-policy";
import {
  activeDeployments,
  appDataSpaces,
  appMembers,
  apps,
  capabilitySets,
  dataConnections,
  deployments,
  organizationMemberships,
  schemaVersions,
  usageEvents,
  type ToolflowDatabase,
} from "@toolflow/database";
import type { RuntimeContext, RuntimeContextSigner } from "@toolflow/runtime-context";
import type { SecretVault } from "@toolflow/secrets";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { Client } from "pg";
import Cursor from "pg-cursor";
import { z } from "zod";

interface Dependencies {
  database: ToolflowDatabase["db"];
  pool: Pool;
  signer: RuntimeContextSigner;
  vault: SecretVault;
  audit: AuditWriter;
}
export interface Variables {
  runtime: RuntimeContext;
}

const externalQueryInput = z.object({
  connection: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sql: z.string().min(1).max(20_000),
  parameters: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).max(100),
});
const tableInput = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
const valuesInput = z.record(z.unknown());

export function createDataGateway(dependencies: Dependencies) {
  const app = new Hono<{ Variables: Variables }>();
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.use("/v1/*", async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer "))
      return context.json({ message: "Access denied." }, 401);
    try {
      context.set("runtime", await dependencies.signer.verify(authorization.slice(7)));
      await next();
    } catch {
      return context.json({ message: "Access denied." }, 401);
    }
  });

  app.post("/v1/external-query", async (context) => {
    return execute(context, dependencies, "external.read", async (runtime, access) => {
      const input = await readJson(context.req.raw, externalQueryInput);
      const grants = access.capabilities.filter(
        (capability): capability is Extract<AppCapability, { kind: "external_postgres" }> =>
          capability.kind === "external_postgres" && capability.connection === input.connection,
      );
      if (grants.length === 0)
        throw new GatewayError(
          403,
          "CAPABILITY_DENIED",
          "External read capability is not declared.",
        );
      const connection = await loadConnection(
        dependencies.database,
        runtime.organizationId,
        input.connection,
      );
      const connectionConfig = parseConnectionConfig(connection.configuration);
      const approved = new Set(
        connectionConfig.approvedTables.map((table) => `${table.schema}.${table.table}`),
      );
      const analysis = authorizeExternalRead(
        input.sql,
        input.parameters,
        grants
          .filter((grant) => approved.has(`${grant.schema}.${grant.table}`))
          .map(({ schema, table }) => ({ schema, table })),
      );
      const password = await dependencies.vault.get(runtime.organizationId, connection.secretId);
      const result = await externalRead(
        connectionConfig,
        password,
        input.sql,
        input.parameters,
        context.req.raw.signal,
      );
      return {
        response: { rows: result.rows, rowCount: result.rows.length },
        metadata: {
          connection: input.connection,
          relations: analysis.normalizedRelations,
          rowCount: result.rows.length,
          responseBytes: result.bytes,
        },
      };
    });
  });

  app.post("/v1/managed/create", async (context) =>
    execute(context, dependencies, "managed.create", async (_runtime, access) => {
      const input = await readJson(
        context.req.raw,
        z.object({ table: tableInput, values: valuesInput }),
      );
      const table = requireManagedTable(access, input.table, "create");
      const values = validateValues(table, input.values, "create");
      const record = await managedCreate(dependencies.pool, access.schemaName, table, values);
      return { response: { record }, metadata: { table: table.name, affectedRows: 1 } };
    }),
  );

  app.post("/v1/managed/list", async (context) =>
    execute(context, dependencies, "managed.read", async (_runtime, access) => {
      const input = await readJson(
        context.req.raw,
        z.object({
          table: tableInput,
          limit: z.number().int().min(1).max(500).default(100),
          offset: z.number().int().min(0).max(100_000).default(0),
        }),
      );
      const table = requireManagedTable(access, input.table, "read");
      const records = await managedList(
        dependencies.pool,
        access.schemaName,
        table,
        input.limit,
        input.offset,
      );
      return { response: { records }, metadata: { table: table.name, rowCount: records.length } };
    }),
  );

  app.post("/v1/managed/update", async (context) =>
    execute(context, dependencies, "managed.update", async (_runtime, access) => {
      const input = await readJson(
        context.req.raw,
        z.object({ table: tableInput, id: z.string().min(1).max(255), values: valuesInput }),
      );
      const table = requireManagedTable(access, input.table, "update");
      requireSimpleId(table);
      const values = validateValues(table, input.values, "update");
      if (Object.keys(values).length === 0)
        throw new GatewayError(422, "VALIDATION_FAILED", "At least one field is required.");
      const record = await managedUpdate(
        dependencies.pool,
        access.schemaName,
        table,
        input.id,
        values,
      );
      if (!record) throw new GatewayError(404, "NOT_FOUND", "Managed record was not found.");
      return { response: { record }, metadata: { table: table.name, affectedRows: 1 } };
    }),
  );

  app.post("/v1/managed/delete", async (context) =>
    execute(context, dependencies, "managed.delete", async (_runtime, access) => {
      const input = await readJson(
        context.req.raw,
        z.object({ table: tableInput, id: z.string().min(1).max(255) }),
      );
      const table = requireManagedTable(access, input.table, "delete");
      requireSimpleId(table);
      const removed = await managedDelete(dependencies.pool, access.schemaName, table, input.id);
      return {
        response: { removed },
        metadata: { table: table.name, affectedRows: removed ? 1 : 0 },
      };
    }),
  );
  return app;
}

type Access = Awaited<ReturnType<typeof resolveAccess>>;
async function execute(
  context: { get(name: "runtime"): RuntimeContext; json(value: unknown, status?: never): Response },
  dependencies: Dependencies,
  action: string,
  operation: (
    runtime: RuntimeContext,
    access: Access,
  ) => Promise<{ response: unknown; metadata: Record<string, unknown> }>,
): Promise<Response> {
  const started = performance.now();
  const runtime = context.get("runtime");
  let outcome: "succeeded" | "failed" | "denied" = "succeeded";
  let metadata: Record<string, unknown> = {};
  try {
    const access = await resolveAccess(dependencies.database, runtime);
    const result = await operation(runtime, access);
    metadata = result.metadata;
    return Response.json(result.response, {
      headers: { "x-request-id": runtime.requestId, "x-trace-id": runtime.traceId },
    });
  } catch (error) {
    const normalized = normalizeError(error);
    outcome = normalized.status === 401 || normalized.status === 403 ? "denied" : "failed";
    metadata = { errorCode: normalized.code };
    return Response.json(
      { code: normalized.code, message: normalized.message },
      {
        status: normalized.status,
        headers: { "x-request-id": runtime.requestId, "x-trace-id": runtime.traceId },
      },
    );
  } finally {
    const durationMs = Math.round(performance.now() - started);
    await Promise.all([
      dependencies.audit.append({
        organizationId: runtime.organizationId,
        actorType: "user",
        actorId: runtime.userId,
        action: `data.${action}`,
        targetType: "app",
        targetId: runtime.appId,
        environment: runtime.environment,
        requestId: runtime.requestId,
        outcome,
        metadata: { ...metadata, durationMs },
      }),
      dependencies.database.insert(usageEvents).values({
        organizationId: runtime.organizationId,
        appId: runtime.appId,
        deploymentId: runtime.deploymentId,
        environment: runtime.environment,
        eventType: `data.${action}`,
        actorHash: await actorHash(runtime.userId, runtime.organizationId),
        requestId: runtime.requestId,
        traceId: runtime.traceId,
        durationMs,
        outcome,
        dimensions: metadata,
      }),
    ]);
  }
}

async function resolveAccess(database: ToolflowDatabase["db"], runtime: RuntimeContext) {
  const rows = await database
    .select({
      deployment: deployments,
      capabilities: capabilitySets.capabilities,
      schema: schemaVersions.schema,
      schemaName: appDataSpaces.schemaName,
      activeSchemaVersionId: appDataSpaces.activeSchemaVersionId,
      appLifecycle: apps.lifecycle,
    })
    .from(deployments)
    .innerJoin(activeDeployments, eq(activeDeployments.deploymentId, deployments.id))
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .innerJoin(capabilitySets, eq(capabilitySets.id, deployments.capabilitySetId))
    .innerJoin(schemaVersions, eq(schemaVersions.id, deployments.schemaVersionId))
    .innerJoin(
      appDataSpaces,
      and(
        eq(appDataSpaces.appId, deployments.appId),
        eq(appDataSpaces.environment, deployments.environment),
      ),
    )
    .innerJoin(appMembers, eq(appMembers.appId, deployments.appId))
    .innerJoin(organizationMemberships, eq(organizationMemberships.id, appMembers.membershipId))
    .where(
      and(
        eq(deployments.id, runtime.deploymentId),
        eq(deployments.organizationId, runtime.organizationId),
        eq(deployments.appId, runtime.appId),
        eq(deployments.environment, runtime.environment),
        eq(deployments.status, "succeeded"),
        eq(activeDeployments.appId, runtime.appId),
        eq(activeDeployments.environment, runtime.environment),
        eq(appMembers.membershipId, runtime.membershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.appLifecycle === "disabled" || row.appLifecycle === "archived") {
    throw new GatewayError(403, "ACCESS_DENIED", "The app data boundary denied this request.");
  }
  return {
    ...row,
    capabilities: z.array(appCapabilitySchema).parse(row.capabilities),
    appSchema: appManifestSchema.shape.schema.parse(row.schema),
  };
}

async function loadConnection(
  database: ToolflowDatabase["db"],
  organizationId: string,
  slug: string,
) {
  const rows = await database
    .select()
    .from(dataConnections)
    .where(
      and(
        eq(dataConnections.organizationId, organizationId),
        eq(dataConnections.slug, slug),
        eq(dataConnections.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new GatewayError(404, "NOT_FOUND", "Active data connection was not found.");
  return row;
}

interface ConnectionConfiguration {
  host: string;
  port: number;
  database: string;
  username: string;
  tlsMode: "verify-full" | "require" | "disable";
  approvedTables: { schema: string; table: string }[];
}
async function externalRead(
  config: ConnectionConfiguration,
  password: string,
  sql: string,
  parameters: unknown[],
  signal: AbortSignal,
): Promise<{ rows: Record<string, unknown>[]; bytes: number }> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password,
    ssl:
      config.tlsMode === "disable"
        ? false
        : { rejectUnauthorized: config.tlsMode === "verify-full" },
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
  });
  const cancel = () => void client.end().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted)
      throw new GatewayError(503, "REQUEST_CANCELLED", "External query was cancelled.");
    await client.connect();
    await client.query("begin read only");
    await client.query("set local statement_timeout = '5s'");
    const cursor = client.query(new Cursor(sql, parameters));
    const rows = (await cursor.read(1_001)) as Record<string, unknown>[];
    await cursor.close();
    await client.query("rollback");
    if (rows.length > 1_000)
      throw new GatewayError(413, "ROW_LIMIT_EXCEEDED", "External query exceeded 1,000 rows.");
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    if (bytes > 5_000_000)
      throw new GatewayError(413, "BYTE_LIMIT_EXCEEDED", "External query exceeded 5 MB.");
    return { rows, bytes };
  } finally {
    signal.removeEventListener("abort", cancel);
    await client.end().catch(() => undefined);
  }
}

function parseConnectionConfig(value: unknown): ConnectionConfiguration {
  return z
    .object({
      host: z.string(),
      port: z.number().int(),
      database: z.string(),
      username: z.string(),
      tlsMode: z.enum(["verify-full", "require", "disable"]),
      approvedTables: z.array(
        z.object({
          schema: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
          table: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
        }),
      ),
    })
    .parse(value);
}

type AppTable = AppManifest["schema"]["tables"][number];
function requireManagedTable(
  access: Access,
  tableName: string,
  operation: "create" | "read" | "update" | "delete",
) {
  if (!access.activeSchemaVersionId) {
    throw new GatewayError(
      409,
      "SCHEMA_NOT_APPLIED",
      "An app schema has not been applied in this environment.",
    );
  }
  const capability = access.capabilities.find(
    (candidate) =>
      candidate.kind === "app_data" &&
      candidate.table === tableName &&
      candidate.operations.includes(operation),
  );
  if (!capability)
    throw new GatewayError(
      403,
      "CAPABILITY_DENIED",
      `Managed ${operation} capability is not declared.`,
    );
  const table = access.appSchema.tables.find((candidate) => candidate.name === tableName);
  if (!table)
    throw new GatewayError(
      422,
      "VALIDATION_FAILED",
      "Managed table is absent from the deployed schema.",
    );
  return table;
}

function validateValues(
  table: AppTable,
  values: Record<string, unknown>,
  mode: "create" | "update",
) {
  const columns = new Map(table.columns.map((column) => [column.name, column]));
  const validated: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const column = columns.get(name);
    if (!column) throw new GatewayError(422, "VALIDATION_FAILED", `Field ${name} is not declared.`);
    if (mode === "update" && table.primaryKey.includes(name))
      throw new GatewayError(422, "VALIDATION_FAILED", "Primary keys cannot be updated.");
    if (value === null) {
      if (!column.nullable)
        throw new GatewayError(422, "VALIDATION_FAILED", `Field ${name} is required.`);
    } else if (!validColumnValue(column.type, value)) {
      throw new GatewayError(422, "VALIDATION_FAILED", `Field ${name} has the wrong type.`);
    }
    validated[name] = value;
  }
  if (mode === "create") {
    for (const column of table.columns) {
      if (!column.nullable && column.default === undefined && !(column.name in validated)) {
        throw new GatewayError(422, "VALIDATION_FAILED", `Field ${column.name} is required.`);
      }
    }
  }
  return validated;
}

function validColumnValue(type: AppTable["columns"][number]["type"], value: unknown) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "json") return typeof value === "object" || Array.isArray(value);
  if (type === "uuid")
    return typeof value === "string" && z.string().uuid().safeParse(value).success;
  if (type === "timestamp") return typeof value === "string" && !Number.isNaN(Date.parse(value));
  return typeof value === "string";
}
function requireSimpleId(table: AppTable) {
  if (table.primaryKey.length !== 1 || table.primaryKey[0] !== "id") {
    throw new GatewayError(
      422,
      "VALIDATION_FAILED",
      "Update and delete require a single id primary key.",
    );
  }
}

async function managedCreate(
  pool: Pool,
  schema: string,
  table: AppTable,
  values: Record<string, unknown>,
) {
  const entries = Object.entries(values);
  const returning = table.columns.map((column) => quote(column.name)).join(", ");
  const query =
    entries.length === 0
      ? `insert into ${quote(schema)}.${quote(table.name)} default values returning ${returning}`
      : `insert into ${quote(schema)}.${quote(table.name)} (${entries.map(([name]) => quote(name)).join(", ")}) values (${entries.map((_, index) => `$${index + 1}`).join(", ")}) returning ${returning}`;
  const result = await boundedQuery(
    pool,
    query,
    entries.map(([, value]) => value),
  );
  return result.rows[0] as Record<string, unknown>;
}
async function managedList(
  pool: Pool,
  schema: string,
  table: AppTable,
  limit: number,
  offset: number,
) {
  const columns = table.columns.map((column) => quote(column.name)).join(", ");
  const order = table.primaryKey.map(quote).join(", ");
  const result = await boundedQuery(
    pool,
    `select ${columns} from ${quote(schema)}.${quote(table.name)} order by ${order} limit $1 offset $2`,
    [limit, offset],
  );
  return result.rows as Record<string, unknown>[];
}
async function managedUpdate(
  pool: Pool,
  schema: string,
  table: AppTable,
  id: string,
  values: Record<string, unknown>,
) {
  const entries = Object.entries(values);
  const returning = table.columns.map((column) => quote(column.name)).join(", ");
  const result = await boundedQuery(
    pool,
    `update ${quote(schema)}.${quote(table.name)} set ${entries.map(([name], index) => `${quote(name)} = $${index + 1}`).join(", ")} where "id" = $${entries.length + 1} returning ${returning}`,
    [...entries.map(([, value]) => value), id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}
async function managedDelete(pool: Pool, schema: string, table: AppTable, id: string) {
  const result = await boundedQuery(
    pool,
    `delete from ${quote(schema)}.${quote(table.name)} where "id" = $1 returning "id"`,
    [id],
  );
  return result.rowCount === 1;
}
async function boundedQuery(pool: Pool, sql: string, parameters: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '5s'");
    const result = await client.query(sql, parameters);
    await client.query("commit");
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
async function rollback(client: PoolClient) {
  await client.query("rollback").catch(() => undefined);
}
function quote(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe identifier.");
  return `"${value}"`;
}

async function readJson<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 1_000_000) {
    throw new GatewayError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 1 MB.");
  }
  try {
    const value: unknown = JSON.parse(text);
    const parsed: unknown = schema.parse(value);
    return parsed;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(422, "VALIDATION_FAILED", "Request body is invalid.");
  }
}
class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function normalizeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof SqlPolicyError) return new GatewayError(422, error.code, error.message);
  return new GatewayError(500, "INTERNAL_ERROR", "The data request failed.");
}

async function actorHash(userId: string, organizationId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${organizationId}:${userId}`),
  );
  return Buffer.from(digest).toString("hex");
}
