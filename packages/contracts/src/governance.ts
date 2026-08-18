import { z } from "zod";
import { appLifecycleSchema, environmentSchema } from "./apps.js";
import { idSchema, slugSchema } from "./identity.js";
import { appCapabilitySchema } from "./manifest.js";

export const connectionStatusSchema = z.enum(["draft", "active", "disabled"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const postgresConnectionInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535).default(5432),
  database: z.string().trim().min(1).max(63),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(10_000),
  tlsMode: z.enum(["verify-full", "require", "disable"]).default("verify-full"),
  approvedTables: z
    .array(
      z.object({
        schema: z.string().min(1).max(63),
        table: z.string().min(1).max(63),
      }),
    )
    .max(500)
    .default([]),
});
export type PostgresConnectionInput = z.infer<typeof postgresConnectionInputSchema>;

export const updatePostgresConnectionInputSchema = postgresConnectionInputSchema
  .omit({ slug: true, password: true })
  .partial()
  .extend({ password: z.string().min(1).max(10_000).optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");
export type UpdatePostgresConnectionInput = z.infer<typeof updatePostgresConnectionInputSchema>;

export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  serverVersion: z.string().nullable(),
  visibleSchemas: z.array(z.string()),
  prohibitedPrivileges: z.array(z.string()),
  testedAt: z.string().datetime(),
  message: z.string(),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const dataConnectionSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string(),
  kind: z.literal("postgresql"),
  status: connectionStatusSchema,
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  username: z.string(),
  tlsMode: z.enum(["verify-full", "require", "disable"]),
  approvedTables: z.array(z.object({ schema: z.string(), table: z.string() })),
  disabledReason: z.string().nullable(),
  lastTestedAt: z.string().datetime().nullable(),
  lastTestResult: connectionTestResultSchema.nullable(),
});
export type DataConnection = z.infer<typeof dataConnectionSchema>;

export const connectionStateInputSchema = z.object({
  status: z.enum(["active", "disabled"]),
  reason: z.string().trim().min(3).max(1_000),
  confirmationName: z.string().trim().min(1),
});
export type ConnectionStateInput = z.infer<typeof connectionStateInputSchema>;

export const catalogLifecycleSchema = z.enum(["active", "deprecated", "hidden"]);
export const sensitivitySchema = z.enum(["public", "internal", "confidential", "restricted"]);
export const catalogObjectSchema = z.object({
  id: idSchema,
  connectionId: idSchema,
  connectionName: z.string(),
  parentId: idSchema.nullable(),
  kind: z.enum(["schema", "table", "column"]),
  schemaName: z.string(),
  objectName: z.string(),
  dataType: z.string().nullable(),
  nullable: z.boolean().nullable(),
  lifecycle: catalogLifecycleSchema,
  sensitivity: sensitivitySchema,
  description: z.string(),
  businessOwner: z.string().nullable(),
  sourceOfTruth: z.boolean(),
  catalogVersion: z.number().int(),
  metadata: z.record(z.unknown()),
});
export type CatalogObject = z.infer<typeof catalogObjectSchema>;

export const updateCatalogObjectInputSchema = z
  .object({
    lifecycle: catalogLifecycleSchema.optional(),
    sensitivity: sensitivitySchema.optional(),
    description: z.string().trim().max(5_000).optional(),
    businessOwner: z.string().trim().max(255).nullable().optional(),
    sourceOfTruth: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");
export type UpdateCatalogObjectInput = z.infer<typeof updateCatalogObjectInputSchema>;

export const catalogRefreshInputSchema = z.object({
  apply: z.boolean().default(false),
  expectedDiffHash: z.string().optional(),
});
export type CatalogRefreshInput = z.infer<typeof catalogRefreshInputSchema>;

export const catalogRefreshResultSchema = z.object({
  diffHash: z.string(),
  additions: z.number().int().nonnegative(),
  changes: z.array(z.object({ object: z.string(), change: z.string(), breaking: z.boolean() })),
  removals: z.array(z.string()),
  applied: z.boolean(),
  catalogVersion: z.number().int().positive(),
});
export type CatalogRefreshResult = z.infer<typeof catalogRefreshResultSchema>;

export const adminAppSummarySchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  lifecycle: appLifecycleSchema,
  ownerNames: z.array(z.string()),
  activeVersion: z.string().nullable(),
  lastDeploymentAt: z.string().datetime().nullable(),
  memberCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().datetime().nullable(),
  health: z.enum(["healthy", "degraded", "inactive", "disabled"]),
  disabledReason: z.string().nullable(),
});
export type AdminAppSummary = z.infer<typeof adminAppSummarySchema>;

export const adminAppMemberSchema = z.object({
  membershipId: idSchema,
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "builder", "member"]),
  status: z.enum(["invited", "active", "deactivated"]),
  owner: z.boolean(),
  appAccess: z.boolean(),
});

export const adminSourceVersionSchema = z.object({
  id: idSchema,
  parentVersionId: idSchema.nullable(),
  actorMembershipId: idSchema,
  message: z.string(),
  contentHash: z.string(),
  manifestHash: z.string(),
  fileCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const adminBuildSchema = z.object({
  id: idSchema,
  sourceVersionId: idSchema,
  runtimeVersionId: idSchema,
  status: z.enum(["queued", "running", "succeeded", "failed", "timed_out"]),
  artifactHash: z.string().nullable(),
  diagnostics: z.array(z.unknown()),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const adminDeploymentSchema = z.object({
  id: idSchema,
  environment: environmentSchema,
  actorMembershipId: idSchema,
  sourceVersionId: idSchema,
  buildId: idSchema,
  capabilitySetId: idSchema,
  schemaVersionId: idSchema.nullable(),
  runtimeVersionId: idSchema,
  artifactHash: z.string(),
  providerDeploymentId: z.string().nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  active: z.boolean(),
  failure: z.unknown().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const adminAppDetailSchema = z.object({
  summary: adminAppSummarySchema,
  members: z.array(adminAppMemberSchema),
  sourceVersions: z.array(adminSourceVersionSchema),
  builds: z.array(adminBuildSchema),
  deployments: z.array(adminDeploymentSchema),
  declaredCapabilities: z
    .object({
      id: idSchema,
      sourceVersionId: idSchema,
      hash: z.string(),
      capabilities: z.array(appCapabilitySchema),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  declaredSchema: z
    .object({
      id: idSchema,
      sourceVersionId: idSchema,
      hash: z.string(),
      schema: z.record(z.unknown()),
      createdAt: z.string().datetime(),
    })
    .nullable(),
});
export type AdminAppDetail = z.infer<typeof adminAppDetailSchema>;

export const appStateInputSchema = z.object({
  disabled: z.boolean(),
  reason: z.string().trim().min(3).max(1_000),
  confirmationName: z.string().trim().min(1),
});
export type AppStateInput = z.infer<typeof appStateInputSchema>;

export const auditEventViewSchema = z.object({
  id: idSchema,
  occurredAt: z.string().datetime(),
  actorType: z.string(),
  actorId: idSchema,
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  environment: environmentSchema.nullable(),
  requestId: z.string(),
  outcome: z.enum(["succeeded", "failed", "denied"]),
  metadata: z.record(z.unknown()),
});
export type AuditEventView = z.infer<typeof auditEventViewSchema>;

export const overviewMetricsSchema = z.object({
  productionApps: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  appsRequiringAttention: z.number().int().nonnegative(),
});
export type OverviewMetrics = z.infer<typeof overviewMetricsSchema>;
