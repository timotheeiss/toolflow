import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3006),
  TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN: z.string().min(32),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_PREVIEW_NAMESPACE: z.string().min(1).optional(),
  CLOUDFLARE_PRODUCTION_NAMESPACE: z.string().min(1).optional(),
  TOOLFLOW_DISPATCH_HEALTH_URL: z.string().url().optional(),
  TOOLFLOW_DISPATCH_HEALTH_TOKEN: z.string().min(32).optional(),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const config = schema.parse(environment);
  if (
    config.NODE_ENV === "production" &&
    (!config.CLOUDFLARE_ACCOUNT_ID ||
      !config.CLOUDFLARE_API_TOKEN ||
      !config.CLOUDFLARE_PREVIEW_NAMESPACE ||
      !config.CLOUDFLARE_PRODUCTION_NAMESPACE ||
      !config.TOOLFLOW_DISPATCH_HEALTH_URL ||
      !config.TOOLFLOW_DISPATCH_HEALTH_TOKEN)
  ) {
    throw new Error("Cloudflare Workers for Platforms configuration is incomplete.");
  }
  if (
    config.NODE_ENV === "production" &&
    config.TOOLFLOW_DISPATCH_HEALTH_URL &&
    !config.TOOLFLOW_DISPATCH_HEALTH_URL.startsWith("https://")
  ) {
    throw new Error("Production dispatch health checks must use HTTPS.");
  }
  return config;
}
