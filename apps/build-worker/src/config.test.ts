import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("build worker config", () => {
  it("applies bounded build defaults", () => {
    const config = parseConfig({ DATABASE_URL: "postgresql://localhost/toolflow" });
    expect(config.TOOLFLOW_BUILD_TIMEOUT_MS).toBe(300_000);
    expect(config.TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES).toBe(8 * 1024 * 1024);
  });

  it("rejects timeouts above five minutes", () => {
    expect(() =>
      parseConfig({
        DATABASE_URL: "postgresql://localhost/toolflow",
        TOOLFLOW_BUILD_TIMEOUT_MS: "300001",
      }),
    ).toThrow();
  });
});
