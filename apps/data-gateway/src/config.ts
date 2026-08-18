import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TOOLFLOW_DEPLOYMENT_TIER: z.enum(["standard", "trusted-pilot"]).default("standard"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3005),
  DATABASE_URL: z.string().url(),
  TOOLFLOW_RUNTIME_CONTEXT_SECRET: z
    .string()
    .default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  TOOLFLOW_SECRET_ENCRYPTION_KEY: z
    .string()
    .default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  TOOLFLOW_SECRET_BACKEND: z.enum(["local", "kms"]).default("local"),
  TOOLFLOW_KMS_URL: z.string().url().optional(),
  TOOLFLOW_KMS_SERVICE_TOKEN: z.string().min(32).optional(),
  TOOLFLOW_KMS_KEY_ID: z.string().min(1).optional(),
  TOOLFLOW_KMS_PROVIDER_NAME: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    .default("kms"),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const config = schema.parse(environment);
  for (const [name, encoded] of [
    ["TOOLFLOW_RUNTIME_CONTEXT_SECRET", config.TOOLFLOW_RUNTIME_CONTEXT_SECRET],
  ] as const) {
    if (Buffer.from(encoded, "base64").byteLength !== 32) {
      throw new Error(`${name} must be a base64-encoded 32-byte key.`);
    }
    if (
      config.NODE_ENV === "production" &&
      encoded === "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    ) {
      throw new Error(`The development ${name} cannot run in production.`);
    }
  }
  if (config.TOOLFLOW_SECRET_BACKEND === "local") {
    if (Buffer.from(config.TOOLFLOW_SECRET_ENCRYPTION_KEY, "base64").byteLength !== 32) {
      throw new Error("TOOLFLOW_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }
    if (config.NODE_ENV === "production" && config.TOOLFLOW_DEPLOYMENT_TIER !== "trusted-pilot")
      throw new Error("Production requires KMS unless TOOLFLOW_DEPLOYMENT_TIER is trusted-pilot.");
  } else if (
    !config.TOOLFLOW_KMS_URL?.startsWith("https://") ||
    !config.TOOLFLOW_KMS_SERVICE_TOKEN ||
    !config.TOOLFLOW_KMS_KEY_ID
  ) {
    throw new Error("The KMS secret backend requires an HTTPS URL, service token, and key ID.");
  }
  return config;
}
