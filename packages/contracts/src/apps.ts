import { z } from "zod";
import { idSchema, slugSchema } from "./identity.js";

export const appLifecycleSchema = z.enum([
  "draft",
  "preview",
  "production",
  "disabled",
  "orphaned",
  "archived",
]);
export type AppLifecycle = z.infer<typeof appLifecycleSchema>;

export const environmentSchema = z.enum(["preview", "production"]);
export type Environment = z.infer<typeof environmentSchema>;

export const appSummarySchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000),
  lifecycle: appLifecycleSchema,
  ownerIds: z.array(idSchema).min(1),
  productionUrl: z.string().url().nullable(),
  lastDeploymentAt: z.string().datetime().nullable(),
});
export type AppSummary = z.infer<typeof appSummarySchema>;

export const createAppInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  ownerId: idSchema,
  idempotencyKey: z.string().min(8).max(255),
});
export type CreateAppInput = z.infer<typeof createAppInputSchema>;

export const sourceFileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(2_000_000),
});
export type SourceFile = z.infer<typeof sourceFileSchema>;

export const updateAppFilesInputSchema = z.object({
  appId: idSchema,
  baseVersionId: idSchema,
  files: z.array(sourceFileSchema).max(100),
  deletedPaths: z.array(z.string().min(1).max(512)).max(100).default([]),
  message: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(8).max(255),
});
export type UpdateAppFilesInput = z.infer<typeof updateAppFilesInputSchema>;

export const sourceVersionSchema = z.object({
  id: idSchema,
  appId: idSchema,
  parentVersionId: idSchema.nullable(),
  actorMembershipId: idSchema,
  message: z.string(),
  contentHash: z.string(),
  manifestHash: z.string(),
  fileCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type SourceVersion = z.infer<typeof sourceVersionSchema>;

export const appActivitySchema = z.object({
  appId: idSchema,
  environment: environmentSchema.nullable(),
  window: z.enum(["24h", "7d", "30d"]),
  requestCount: z.number().int().nonnegative(),
  uniqueActiveMembers: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
  externalQueryCount: z.number().int().nonnegative(),
  managedWriteCount: z.number().int().nonnegative(),
  buildOutcomes: z.object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    timedOut: z.number().int().nonnegative(),
  }),
  deploymentOutcomes: z.object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  lastActivityAt: z.string().datetime().nullable(),
  recentErrors: z.array(
    z.object({
      requestId: z.string(),
      deploymentId: idSchema.nullable(),
      eventType: z.string(),
      environment: environmentSchema,
      occurredAt: z.string().datetime(),
    }),
  ),
});
export type AppActivity = z.infer<typeof appActivitySchema>;

export const sourceBundleSchema = z.object({
  version: z.literal(1),
  files: z.array(sourceFileSchema).max(200),
});
export type SourceBundle = z.infer<typeof sourceBundleSchema>;
