import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const productionIdentity = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://localhost/toolflow",
  TOOLFLOW_AUTH_MODE: "oidc",
  WORKOS_ISSUER: "https://auth.toolflow.test",
  WORKOS_AUDIENCE: "toolflow-control",
  WORKOS_JWKS_URL: "https://auth.toolflow.test/jwks",
  WORKOS_API_KEY: "workos-key",
  WORKOS_CLIENT_ID: "workos-client",
  WORKOS_COOKIE_PASSWORD: "c".repeat(32),
};

describe("control API secret backend config", () => {
  it("refuses a raw local master key in production", () => {
    expect(() =>
      parseConfig({
        ...productionIdentity,
        TOOLFLOW_SECRET_BACKEND: "local",
        TOOLFLOW_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow("KMS");
  });

  it("accepts a complete HTTPS KMS broker boundary in production", () => {
    expect(
      parseConfig({
        ...productionIdentity,
        TOOLFLOW_SECRET_BACKEND: "kms",
        TOOLFLOW_KMS_URL: "https://kms.toolflow.test",
        TOOLFLOW_KMS_SERVICE_TOKEN: "s".repeat(32),
        TOOLFLOW_KMS_KEY_ID: "pilot-connections",
      }).TOOLFLOW_SECRET_BACKEND,
    ).toBe("kms");
  });
});
