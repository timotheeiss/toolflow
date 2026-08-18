import type {
  ConnectionTestResult,
  DataConnection,
  PostgresConnectionInput,
} from "@toolflow/contracts";
import { Client } from "pg";

export interface DiscoveredCatalogObject {
  kind: "schema" | "table" | "column";
  schemaName: string;
  objectName: string;
  parentIdentity: string | null;
  dataType: string | null;
  nullable: boolean | null;
  metadata: Record<string, unknown>;
}

export interface ConnectionInspector {
  test(
    connection: Omit<DataConnection, "lastTestResult">,
    password: string,
  ): Promise<ConnectionTestResult>;
  discover(connection: DataConnection, password: string): Promise<DiscoveredCatalogObject[]>;
}

function clientFor(
  connection: Pick<DataConnection, "host" | "port" | "database" | "username" | "tlsMode">,
  password: string,
): Client {
  return new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
    ssl:
      connection.tlsMode === "disable"
        ? false
        : connection.tlsMode === "require"
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true },
  });
}

export class PostgresConnectionInspector implements ConnectionInspector {
  async test(
    connection: Omit<DataConnection, "lastTestResult">,
    password: string,
  ): Promise<ConnectionTestResult> {
    const testedAt = new Date().toISOString();
    const client = clientFor(connection, password);
    try {
      await client.connect();
      const [version, schemas, databasePrivileges, schemaPrivileges, tablePrivileges] =
        await Promise.all([
          client.query<{ server_version: string }>("show server_version"),
          client.query<{ schema_name: string }>(
            `select schema_name from information_schema.schemata
             where schema_name not like 'pg_%' and schema_name <> 'information_schema'
             order by schema_name`,
          ),
          client.query<{ can_create: boolean; can_temp: boolean }>(
            `select
               has_database_privilege(current_user, current_database(), 'CREATE') as can_create,
               has_database_privilege(current_user, current_database(), 'TEMP') as can_temp`,
          ),
          client.query<{ schema_name: string }>(
            `select schema_name from information_schema.schemata
             where has_schema_privilege(current_user, schema_name, 'CREATE')`,
          ),
          client.query<{ table_schema: string; table_name: string; privilege_type: string }>(
            `select table_schema, table_name, privilege_type
             from information_schema.role_table_grants
             where grantee = current_user
               and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
          ),
        ]);
      const prohibitedPrivileges: string[] = [];
      if (databasePrivileges.rows[0]?.can_create) prohibitedPrivileges.push("database:create");
      if (databasePrivileges.rows[0]?.can_temp) prohibitedPrivileges.push("database:temporary");
      prohibitedPrivileges.push(
        ...schemaPrivileges.rows.map((row) => `schema:${row.schema_name}:create`),
        ...tablePrivileges.rows.map(
          (row) =>
            `table:${row.table_schema}.${row.table_name}:${row.privilege_type.toLowerCase()}`,
        ),
      );
      const ok = prohibitedPrivileges.length === 0;
      return {
        ok,
        serverVersion: version.rows[0]?.server_version ?? null,
        visibleSchemas: schemas.rows.map((row) => row.schema_name),
        prohibitedPrivileges,
        testedAt,
        message: ok
          ? "Connection succeeded and the role is read-only."
          : "Connection succeeded, but the role has write or object-creation privileges.",
      };
    } catch (error) {
      return {
        ok: false,
        serverVersion: null,
        visibleSchemas: [],
        prohibitedPrivileges: [],
        testedAt,
        message: error instanceof Error ? error.message : "Connection failed.",
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async discover(connection: DataConnection, password: string): Promise<DiscoveredCatalogObject[]> {
    const client = clientFor(connection, password);
    try {
      await client.connect();
      const approved = new Set(
        connection.approvedTables.map((table) => `${table.schema}.${table.table}`),
      );
      if (approved.size === 0) return [];
      const result = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        ordinal_position: number;
        is_primary_key: boolean;
      }>(
        `select c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable,
                c.ordinal_position,
                exists (
                  select 1 from information_schema.table_constraints tc
                  join information_schema.key_column_usage kcu
                    on tc.constraint_name = kcu.constraint_name
                   and tc.constraint_schema = kcu.constraint_schema
                  where tc.constraint_type = 'PRIMARY KEY'
                    and tc.table_schema = c.table_schema
                    and tc.table_name = c.table_name
                    and kcu.column_name = c.column_name
                ) as is_primary_key
         from information_schema.columns c
         order by c.table_schema, c.table_name, c.ordinal_position`,
      );
      const objects: DiscoveredCatalogObject[] = [];
      const schemas = new Set<string>();
      const tables = new Set<string>();
      for (const column of result.rows) {
        const tableIdentity = `${column.table_schema}.${column.table_name}`;
        if (!approved.has(tableIdentity)) continue;
        if (!schemas.has(column.table_schema)) {
          schemas.add(column.table_schema);
          objects.push({
            kind: "schema",
            schemaName: column.table_schema,
            objectName: column.table_schema,
            parentIdentity: null,
            dataType: null,
            nullable: null,
            metadata: {},
          });
        }
        if (!tables.has(tableIdentity)) {
          tables.add(tableIdentity);
          objects.push({
            kind: "table",
            schemaName: column.table_schema,
            objectName: column.table_name,
            parentIdentity: `schema:${column.table_schema}:${column.table_schema}`,
            dataType: null,
            nullable: null,
            metadata: {},
          });
        }
        objects.push({
          kind: "column",
          schemaName: column.table_schema,
          objectName: `${column.table_name}.${column.column_name}`,
          parentIdentity: `table:${tableIdentity}`,
          dataType: column.data_type,
          nullable: column.is_nullable === "YES",
          metadata: {
            table: column.table_name,
            column: column.column_name,
            ordinalPosition: column.ordinal_position,
            primaryKey: column.is_primary_key,
          },
        });
      }
      return objects;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

export function connectionFromInput(
  id: string,
  input: PostgresConnectionInput,
): Omit<DataConnection, "lastTestResult"> {
  return {
    id,
    slug: input.slug,
    name: input.name,
    kind: "postgresql",
    status: "draft",
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    tlsMode: input.tlsMode,
    approvedTables: input.approvedTables,
    disabledReason: null,
    lastTestedAt: null,
  };
}
