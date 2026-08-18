import { z } from "zod";
import { slugSchema } from "./identity.js";

const identifierSchema = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);

export const externalCapabilitySchema = z.object({
  kind: z.literal("external_postgres"),
  connection: slugSchema,
  schema: identifierSchema,
  table: identifierSchema,
  operations: z.tuple([z.literal("read")]),
});

export const appDataCapabilitySchema = z.object({
  kind: z.literal("app_data"),
  table: identifierSchema,
  operations: z.array(z.enum(["create", "read", "update", "delete"])).min(1),
});

export const appCapabilitySchema = z.discriminatedUnion("kind", [
  externalCapabilitySchema,
  appDataCapabilitySchema,
]);
export type AppCapability = z.infer<typeof appCapabilitySchema>;

export const appColumnSchema = z.object({
  name: identifierSchema,
  type: z.enum(["text", "integer", "boolean", "timestamp", "uuid", "json"]),
  nullable: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const appForeignKeySchema = z.object({
  columns: z.array(identifierSchema).min(1),
  referencedTable: identifierSchema,
  referencedColumns: z.array(identifierSchema).min(1),
});

export const appTableSchema = z.object({
  name: identifierSchema,
  columns: z.array(appColumnSchema).min(1),
  primaryKey: z.array(identifierSchema).min(1),
  indexes: z.array(z.array(identifierSchema).min(1)).default([]),
  foreignKeys: z.array(appForeignKeySchema).default([]),
});

export const appManifestSchema = z.object({
  manifestVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  runtime: z.literal("toolflow-react-v1"),
  capabilities: z.array(appCapabilitySchema).default([]),
  schema: z.object({ tables: z.array(appTableSchema).default([]) }).default({ tables: [] }),
  routes: z.array(z.object({ path: z.string().startsWith("/") })).min(1),
  healthcheck: z.literal("/api/health"),
});
export type AppManifest = z.infer<typeof appManifestSchema>;

export function capabilityKey(capability: AppCapability): string {
  if (capability.kind === "external_postgres") {
    return [
      capability.kind,
      capability.connection,
      capability.schema,
      capability.table,
      ...capability.operations,
    ].join(":");
  }

  return [capability.kind, capability.table, ...[...capability.operations].sort()].join(":");
}
