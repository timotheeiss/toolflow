import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("runtime dispatcher config", () => {
  it("refuses production without the internal authorization service token", () => {
    expect(() =>
      parseConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/toolflow",
        TOOLFLOW_AUTH_MODE: "oidc",
        TOOLFLOW_RUNTIME_CONTEXT_SECRET: Buffer.alloc(32, 1).toString("base64"),
        WORKOS_ISSUER: "https://api.workos.com",
        WORKOS_AUDIENCE: "toolflow",
        WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/client",
        WORKOS_API_KEY: "key",
        WORKOS_CLIENT_ID: "client",
        WORKOS_COOKIE_PASSWORD: "c".repeat(32),
      }),
    ).toThrow("internal service token");
  });
});
