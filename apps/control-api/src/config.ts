import { z } from "zod";

const baseConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TOOLFLOW_DEPLOYMENT_TIER: z.enum(["standard", "trusted-pilot"]).default("standard"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url(),
  TOOLFLOW_AUTH_MODE: z.enum(["development", "oidc"]).default("development"),
  TOOLFLOW_ADMIN_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  TOOLFLOW_OBJECT_STORE_PATH: z.string().default(".toolflow/objects"),
  TOOLFLOW_ALLOW_INSECURE_DATABASE_TLS: z.coerce.boolean().default(false),
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
  WORKOS_ISSUER: z.string().url().optional(),
  WORKOS_AUDIENCE: z.string().min(1).optional(),
  WORKOS_JWKS_URL: z.string().url().optional(),
  WORKOS_API_KEY: z.string().min(1).optional(),
  WORKOS_CLIENT_ID: z.string().min(1).optional(),
  WORKOS_COOKIE_PASSWORD: z.string().min(32).optional(),
  TOOLFLOW_COOKIE_DOMAIN: z.string().regex(/^\.[a-z0-9.-]+$/i).optional(),
  WORKOS_REDIRECT_URI: z.string().url().default("http://127.0.0.1:3000/auth/callback"),
});

export type ControlApiConfig = z.infer<typeof baseConfigSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): ControlApiConfig {
  const config = baseConfigSchema.parse(environment);
  if (config.NODE_ENV === "production" && config.TOOLFLOW_AUTH_MODE === "development") {
    throw new Error("Development authentication cannot run in production.");
  }
  if (
    config.TOOLFLOW_AUTH_MODE === "oidc" &&
    (!config.WORKOS_ISSUER || !config.WORKOS_AUDIENCE || !config.WORKOS_JWKS_URL)
  ) {
    throw new Error("OIDC authentication requires issuer, audience, and JWKS URL.");
  }
  if (
    config.TOOLFLOW_AUTH_MODE === "oidc" &&
    (!config.WORKOS_API_KEY || !config.WORKOS_CLIENT_ID || !config.WORKOS_COOKIE_PASSWORD)
  ) {
    throw new Error("AuthKit requires API key, client ID, and cookie password.");
  }
  if (config.TOOLFLOW_SECRET_BACKEND === "local") {
    const key = Buffer.from(config.TOOLFLOW_SECRET_ENCRYPTION_KEY, "base64");
    if (key.byteLength !== 32) {
      throw new Error("TOOLFLOW_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }
    if (config.NODE_ENV === "production" && config.TOOLFLOW_DEPLOYMENT_TIER !== "trusted-pilot") {
      throw new Error("Production requires KMS unless TOOLFLOW_DEPLOYMENT_TIER is trusted-pilot.");
    }
  } else {
    if (!config.TOOLFLOW_KMS_URL?.startsWith("https://")) {
      throw new Error("The KMS secret backend requires an HTTPS TOOLFLOW_KMS_URL.");
    }
    if (!config.TOOLFLOW_KMS_SERVICE_TOKEN || !config.TOOLFLOW_KMS_KEY_ID) {
      throw new Error("The KMS secret backend requires its service token and key ID.");
    }
  }
  if (
    config.NODE_ENV === "production" &&
    config.TOOLFLOW_DEPLOYMENT_TIER === "trusted-pilot" &&
    !config.TOOLFLOW_COOKIE_DOMAIN
  ) {
    throw new Error("Trusted-pilot production requires TOOLFLOW_COOKIE_DOMAIN.");
  }
  return config;
}
