import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TOOLFLOW_DEPLOYMENT_TIER: z.enum(["standard", "trusted-pilot"]).default("standard"),
  PORT: z.coerce.number().int().default(3004),
  DATABASE_URL: z.string().url(),
  TOOLFLOW_AUTH_MODE: z.enum(["development", "oidc"]).default("development"),
  TOOLFLOW_OBJECT_STORE_PATH: z.string().default(".toolflow/objects"),
  TOOLFLOW_DATA_GATEWAY_URL: z.string().url().default("http://127.0.0.1:3005"),
  TOOLFLOW_RUNTIME_AUTHORIZATION_SERVICE_TOKEN: z.string().min(32).optional(),
  TOOLFLOW_RUNTIME_CONTEXT_SECRET: z
    .string()
    .default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  WORKOS_ISSUER: z.string().url().optional(),
  WORKOS_AUDIENCE: z.string().optional(),
  WORKOS_JWKS_URL: z.string().url().optional(),
  WORKOS_API_KEY: z.string().min(1).optional(),
  WORKOS_CLIENT_ID: z.string().min(1).optional(),
  WORKOS_COOKIE_PASSWORD: z.string().min(32).optional(),
  TOOLFLOW_COOKIE_DOMAIN: z.string().regex(/^\.[a-z0-9.-]+$/i).optional(),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const config = schema.parse(environment);
  if (config.NODE_ENV === "production" && config.TOOLFLOW_AUTH_MODE === "development")
    throw new Error("Development runtime authentication cannot run in production.");
  if (
    config.TOOLFLOW_AUTH_MODE === "oidc" &&
    (!config.WORKOS_ISSUER || !config.WORKOS_AUDIENCE || !config.WORKOS_JWKS_URL)
  )
    throw new Error("OIDC runtime authentication is incomplete.");
  if (
    config.TOOLFLOW_AUTH_MODE === "oidc" &&
    (!config.WORKOS_API_KEY || !config.WORKOS_CLIENT_ID || !config.WORKOS_COOKIE_PASSWORD)
  )
    throw new Error("AuthKit runtime session authentication is incomplete.");
  const contextSecret = Buffer.from(config.TOOLFLOW_RUNTIME_CONTEXT_SECRET, "base64");
  if (contextSecret.byteLength !== 32)
    throw new Error("TOOLFLOW_RUNTIME_CONTEXT_SECRET must be a base64-encoded 32-byte key.");
  if (
    config.NODE_ENV === "production" &&
    config.TOOLFLOW_RUNTIME_CONTEXT_SECRET === "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  )
    throw new Error("The development runtime context secret cannot run in production.");
  if (config.NODE_ENV === "production" && !config.TOOLFLOW_RUNTIME_AUTHORIZATION_SERVICE_TOKEN) {
    throw new Error("Production runtime authorization requires its internal service token.");
  }
  if (
    config.NODE_ENV === "production" &&
    config.TOOLFLOW_DEPLOYMENT_TIER === "trusted-pilot" &&
    !config.TOOLFLOW_COOKIE_DOMAIN
  ) {
    throw new Error("Trusted-pilot runtime authentication requires TOOLFLOW_COOKIE_DOMAIN.");
  }
  return config;
}
