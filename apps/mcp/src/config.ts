import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TOOLFLOW_DEPLOYMENT_TIER: z.enum(["standard", "trusted-pilot"]).default("standard"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.string().url(),
  TOOLFLOW_AUTH_MODE: z.enum(["development", "oidc"]).default("development"),
  TOOLFLOW_MCP_RESOURCE_URL: z.string().url().default("http://127.0.0.1:3001/mcp"),
  TOOLFLOW_MCP_ALLOWED_HOSTS: z.string().default("127.0.0.1,localhost"),
  TOOLFLOW_MCP_ALLOWED_ORIGINS: z.string().default("127.0.0.1,localhost"),
  TOOLFLOW_OBJECT_STORE_PATH: z.string().default(".toolflow/objects"),
  TOOLFLOW_RUNTIME_BASE_URL: z.string().url().default("http://127.0.0.1:3004"),
  TOOLFLOW_DEPLOYMENT_SERVICE_URL: z.string().url().optional(),
  TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN: z.string().min(32).optional(),
  TOOLFLOW_BUILD_EXECUTION: z.enum(["inline", "external"]).default("inline"),
  TOOLFLOW_BUILD_SERVICE_URL: z.string().url().optional(),
  TOOLFLOW_BUILD_SERVICE_TOKEN: z.string().min(32).optional(),
  WORKOS_ISSUER: z.string().url().default("http://127.0.0.1:3001"),
  WORKOS_AUDIENCE: z.string().min(1).default("http://127.0.0.1:3001/mcp"),
  WORKOS_JWKS_URL: z.string().url().optional(),
  WORKOS_AUTHORIZATION_ENDPOINT: z.string().url().default("http://127.0.0.1:3001/oauth/authorize"),
  WORKOS_TOKEN_ENDPOINT: z.string().url().default("http://127.0.0.1:3001/oauth/token"),
  WORKOS_REGISTRATION_ENDPOINT: z.string().url().optional(),
});

export type McpConfig = z.infer<typeof configSchema> & {
  allowedHosts: string[];
  allowedOrigins: string[];
};

export function parseConfig(environment: NodeJS.ProcessEnv): McpConfig {
  const config = configSchema.parse(environment);
  if (config.NODE_ENV === "production") {
    if (config.TOOLFLOW_AUTH_MODE === "development") {
      throw new Error("Development MCP authentication cannot run in production.");
    }
    if (!config.WORKOS_JWKS_URL) throw new Error("WORKOS_JWKS_URL is required in production.");
    if (!config.TOOLFLOW_MCP_RESOURCE_URL.startsWith("https://")) {
      throw new Error("The production MCP resource URL must use HTTPS.");
    }
    if (!config.TOOLFLOW_DEPLOYMENT_SERVICE_URL || !config.TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN) {
      throw new Error("The production deployment service URL and token are required.");
    }
    if (config.TOOLFLOW_BUILD_EXECUTION !== "external") {
      throw new Error("Production MCP requires the external build worker.");
    }
    if (!config.TOOLFLOW_BUILD_SERVICE_URL || !config.TOOLFLOW_BUILD_SERVICE_TOKEN) {
      throw new Error("Production MCP requires the external build service URL and token.");
    }
  }
  return {
    ...config,
    allowedHosts: config.TOOLFLOW_MCP_ALLOWED_HOSTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowedOrigins: config.TOOLFLOW_MCP_ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}
