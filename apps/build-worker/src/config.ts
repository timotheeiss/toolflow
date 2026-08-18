import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TOOLFLOW_DEPLOYMENT_TIER: z.enum(["standard", "trusted-pilot"]).default("standard"),
  DATABASE_URL: z.string().url(),
  TOOLFLOW_BUILD_SERVICE_TOKEN: z.string().min(32).optional(),
  TOOLFLOW_OBJECT_STORE_PATH: z.string().default(".toolflow/objects"),
  TOOLFLOW_BUILD_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  TOOLFLOW_BUILD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(5 * 60_000)
    .default(5 * 60_000),
  TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(16 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  TOOLFLOW_BUILD_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const config = configSchema.parse(environment);
  if (config.NODE_ENV === "production" && !config.TOOLFLOW_BUILD_SERVICE_TOKEN) {
    throw new Error("Production build worker requires TOOLFLOW_BUILD_SERVICE_TOKEN.");
  }
  if (
    config.NODE_ENV === "production" &&
    config.TOOLFLOW_DEPLOYMENT_TIER === "trusted-pilot" &&
    config.TOOLFLOW_BUILD_TIMEOUT_MS > 220_000
  ) {
    throw new Error("Trusted-pilot builds must not exceed 220 seconds.");
  }
  return config;
}
