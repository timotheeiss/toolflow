import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("deployment worker config", () => {
  it("requires Cloudflare publication and private health-probe configuration in production", () => {
    expect(() =>
      parseConfig({
        NODE_ENV: "production",
        TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN: "s".repeat(32),
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_PREVIEW_NAMESPACE: "preview",
        CLOUDFLARE_PRODUCTION_NAMESPACE: "production",
      }),
    ).toThrow("incomplete");
  });

  it("rejects an insecure production health endpoint", () => {
    expect(() =>
      parseConfig({
        NODE_ENV: "production",
        TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN: "s".repeat(32),
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_PREVIEW_NAMESPACE: "preview",
        CLOUDFLARE_PRODUCTION_NAMESPACE: "production",
        TOOLFLOW_DISPATCH_HEALTH_URL: "http://dispatch.example/internal/health",
        TOOLFLOW_DISPATCH_HEALTH_TOKEN: "h".repeat(32),
      }),
    ).toThrow("HTTPS");
  });
});
