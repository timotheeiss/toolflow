import { createHash } from "node:crypto";
import type { Principal } from "@toolflow/auth";
import { appManifestSchema, type AppManifest } from "@toolflow/contracts";
import {
  appDataSpaces,
  appOwners,
  apps,
  schemaPlans,
  schemaVersions,
  type ToolflowDatabase,
} from "@toolflow/database";
import { canManageApp } from "@toolflow/policy";
import { and, desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { planAdditiveSchema, type SchemaOperation } from "./planner.js";

type AppSchema = AppManifest["schema"];

export class AppDataError extends Error {
  constructor(
    readonly code: "AUTHORIZATION_DENIED" | "CONFLICT" | "NOT_FOUND" | "VALIDATION_FAILED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppDataError";
  }
}

export class AppSchemaService {
  constructor(
    private readonly database: ToolflowDatabase["db"],
    private readonly pool: Pool,
  ) {}

  async plan(
    principal: Principal,
    input: { appId: string; sourceVersionId?: string; environment: "preview" | "production" },
  ) {
    await this.assertCanManage(principal, input.appId);
    const targetRows = await this.database
      .select()
      .from(schemaVersions)
      .where(
        and(
          eq(schemaVersions.organizationId, principal.organizationId),
          eq(schemaVersions.appId, input.appId),
          ...(input.sourceVersionId
            ? [eq(schemaVersions.sourceVersionId, input.sourceVersionId)]
            : []),
        ),
      )
      .orderBy(desc(schemaVersions.createdAt))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new AppDataError("NOT_FOUND", "Target app schema version was not found.");
    const spaces = await this.database
      .select({ space: appDataSpaces, current: schemaVersions })
      .from(appDataSpaces)
      .leftJoin(schemaVersions, eq(schemaVersions.id, appDataSpaces.activeSchemaVersionId))
      .where(
        and(eq(appDataSpaces.appId, input.appId), eq(appDataSpaces.environment, input.environment)),
      )
      .limit(1);
    const space = spaces[0];
    if (!space) throw new AppDataError("NOT_FOUND", "App data space was not found.");
    const targetSchema = parseSchema(target.schema);
    const currentSchema = space.current ? parseSchema(space.current.schema) : null;
    let operations: SchemaOperation[];
    try {
      operations = planAdditiveSchema(currentSchema, targetSchema);
    } catch (error) {
      throw new AppDataError(
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "Schema change is not additive.",
      );
    }
    const hash = createHash("sha256")
      .update(stableJson({ from: space.current?.id ?? null, to: target.id, operations }))
      .digest("hex");
    const [inserted] = await this.database
      .insert(schemaPlans)
      .values({
        organizationId: principal.organizationId,
        appId: input.appId,
        environment: input.environment,
        fromSchemaVersionId: space.current?.id,
        toSchemaVersionId: target.id,
        hash,
        operations,
        risk: operations.length === 0 ? "none" : "additive",
      })
      .onConflictDoNothing()
      .returning();
    const plan =
      inserted ??
      (
        await this.database
          .select()
          .from(schemaPlans)
          .where(
            and(
              eq(schemaPlans.appId, input.appId),
              eq(schemaPlans.environment, input.environment),
              eq(schemaPlans.hash, hash),
            ),
          )
          .limit(1)
      )[0];
    if (!plan) throw new Error("Schema plan persistence did not return a record.");
    return planView(plan, space.space.schemaName);
  }

  async applyPreview(principal: Principal, planId: string) {
    const row = await this.loadPlan(principal.organizationId, planId, "preview");
    if (!row) throw new AppDataError("NOT_FOUND", "Preview schema plan was not found.");
    await this.assertCanManage(principal, row.plan.appId);
    return this.applyLoadedPlan(row);
  }

  async applyProduction(organizationId: string, planId: string) {
    const row = await this.loadPlan(organizationId, planId, "production");
    if (!row) throw new AppDataError("NOT_FOUND", "Production schema plan was not found.");
    return this.applyLoadedPlan(row);
  }

  private loadPlan(organizationId: string, planId: string, environment: "preview" | "production") {
    return this.database
      .select({ plan: schemaPlans, space: appDataSpaces, target: schemaVersions })
      .from(schemaPlans)
      .innerJoin(
        appDataSpaces,
        and(
          eq(appDataSpaces.appId, schemaPlans.appId),
          eq(appDataSpaces.environment, schemaPlans.environment),
        ),
      )
      .innerJoin(schemaVersions, eq(schemaVersions.id, schemaPlans.toSchemaVersionId))
      .where(
        and(
          eq(schemaPlans.id, planId),
          eq(schemaPlans.organizationId, organizationId),
          eq(schemaPlans.environment, environment),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  private async applyLoadedPlan(
    row: NonNullable<Awaited<ReturnType<AppSchemaService["loadPlan"]>>>,
  ) {
    if (row.space.activeSchemaVersionId === row.plan.toSchemaVersionId) {
      return { ...planView(row.plan, row.space.schemaName), applied: true, replayed: true };
    }
    if (row.space.activeSchemaVersionId !== row.plan.fromSchemaVersionId) {
      throw new AppDataError("CONFLICT", "Schema plan is stale; generate a new plan.", {
        activeSchemaVersionId: row.space.activeSchemaVersionId,
      });
    }
    const targetSchema = parseSchema(row.target.schema);
    const operations = row.plan.operations as SchemaOperation[];
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `${row.plan.appId}:${row.plan.environment}`,
      ]);
      await client.query(`create schema if not exists ${quoteIdentifier(row.space.schemaName)}`);
      for (const operation of operations) {
        await client.query(compileOperation(row.space.schemaName, operation));
      }
      const activated = await client.query(
        "update app_data_spaces set active_schema_version_id = $1 where id = $2 and active_schema_version_id is not distinct from $3",
        [row.plan.toSchemaVersionId, row.space.id, row.plan.fromSchemaVersionId],
      );
      if (activated.rowCount !== 1) {
        throw new AppDataError("CONFLICT", "Schema plan became stale while it was being applied.");
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return {
      ...planView(row.plan, row.space.schemaName),
      targetTables: targetSchema.tables.map((table) => table.name),
      applied: true,
      replayed: false,
    };
  }

  private async assertCanManage(principal: Principal, appId: string) {
    const rows = await this.database
      .select({ organizationId: apps.organizationId, membershipId: appOwners.membershipId })
      .from(apps)
      .leftJoin(appOwners, eq(appOwners.appId, apps.id))
      .where(and(eq(apps.id, appId), eq(apps.organizationId, principal.organizationId)));
    if (!rows[0]) throw new AppDataError("NOT_FOUND", "App not found.");
    if (
      !canManageApp(
        principal.role,
        principal.membershipId,
        rows.map((row) => row.membershipId).filter(Boolean) as string[],
      )
    ) {
      throw new AppDataError("AUTHORIZATION_DENIED", "App schema access is denied.");
    }
  }
}

function parseSchema(value: unknown): AppSchema {
  return appManifestSchema.shape.schema.parse(value);
}

function planView(plan: typeof schemaPlans.$inferSelect, schemaName: string) {
  return {
    id: plan.id,
    appId: plan.appId,
    environment: plan.environment,
    schemaName,
    fromSchemaVersionId: plan.fromSchemaVersionId,
    toSchemaVersionId: plan.toSchemaVersionId,
    hash: plan.hash,
    operations: plan.operations,
    risk: plan.risk,
    createdAt: plan.createdAt.toISOString(),
  };
}

function compileOperation(schemaName: string, operation: SchemaOperation): string {
  const schema = quoteIdentifier(schemaName);
  if (operation.kind === "create_table") {
    const columns = operation.table.columns.map(compileColumn);
    columns.push(`primary key (${operation.table.primaryKey.map(quoteIdentifier).join(", ")})`);
    const statements = [
      `create table ${schema}.${quoteIdentifier(operation.table.name)} (${columns.join(", ")})`,
      ...operation.table.indexes.map((columns) =>
        compileIndex(schemaName, operation.table.name, columns),
      ),
      ...operation.table.foreignKeys.map((foreignKey) =>
        compileForeignKey(schemaName, operation.table.name, foreignKey),
      ),
    ];
    return statements.join("; ");
  }
  if (operation.kind === "add_column") {
    return `alter table ${schema}.${quoteIdentifier(operation.table)} add column ${compileColumn(operation.column)}`;
  }
  if (operation.kind === "create_index") {
    return compileIndex(schemaName, operation.table, operation.columns);
  }
  return compileForeignKey(schemaName, operation.table, operation.foreignKey);
}

function compileColumn(column: AppSchema["tables"][number]["columns"][number]): string {
  const types = {
    text: "text",
    integer: "integer",
    boolean: "boolean",
    timestamp: "timestamptz",
    uuid: "uuid",
    json: "jsonb",
  } as const;
  const defaultSql = column.default === undefined ? "" : ` default ${literal(column.default)}`;
  return `${quoteIdentifier(column.name)} ${types[column.type]}${column.nullable ? "" : " not null"}${defaultSql}`;
}

function compileIndex(schema: string, table: string, columns: string[]): string {
  const suffix = createHash("sha256")
    .update(`${table}:${columns.join(":")}`)
    .digest("hex")
    .slice(0, 12);
  return `create index ${quoteIdentifier(`idx_${table}_${suffix}`)} on ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})`;
}

function compileForeignKey(
  schema: string,
  table: string,
  foreignKey: AppSchema["tables"][number]["foreignKeys"][number],
): string {
  const suffix = createHash("sha256").update(JSON.stringify(foreignKey)).digest("hex").slice(0, 12);
  return `alter table ${quoteIdentifier(schema)}.${quoteIdentifier(table)} add constraint ${quoteIdentifier(`fk_${table}_${suffix}`)} foreign key (${foreignKey.columns.map(quoteIdentifier).join(", ")}) references ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(quoteIdentifier).join(", ")})`;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe SQL identifier.");
  return `"${value}"`;
}
function literal(value: string | number | boolean): string {
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
