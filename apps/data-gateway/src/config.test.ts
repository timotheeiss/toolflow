import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://localhost/toolflow",
  TOOLFLOW_RUNTIME_CONTEXT_SECRET: Buffer.alloc(32, 5).toString("base64"),
};

describe("data gateway secret backend config", () => {
  it("refuses a raw local master key in production", () => {
    expect(() =>
      parseConfig({
        ...production,
        TOOLFLOW_SECRET_BACKEND: "local",
        TOOLFLOW_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow("KMS");
  });

  it("requires and accepts the complete HTTPS KMS broker boundary", () => {
    expect(() =>
      parseConfig({
        ...production,
        TOOLFLOW_SECRET_BACKEND: "kms",
        TOOLFLOW_KMS_URL: "http://kms.toolflow.test",
        TOOLFLOW_KMS_SERVICE_TOKEN: "s".repeat(32),
        TOOLFLOW_KMS_KEY_ID: "pilot-connections",
      }),
    ).toThrow("KMS");
    expect(
      parseConfig({
        ...production,
        TOOLFLOW_SECRET_BACKEND: "kms",
        TOOLFLOW_KMS_URL: "https://kms.toolflow.test",
        TOOLFLOW_KMS_SERVICE_TOKEN: "s".repeat(32),
        TOOLFLOW_KMS_KEY_ID: "pilot-connections",
      }).TOOLFLOW_SECRET_BACKEND,
    ).toBe("kms");
  });
});
