import type { ToolflowDatabase } from "@toolflow/database";
import { RuntimeContextSigner } from "@toolflow/runtime-context";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createDataGateway } from "./app.js";

function gateway() {
  return createDataGateway({
    database: {} as ToolflowDatabase["db"],
    pool: {} as Pool,
    signer: new RuntimeContextSigner(new Uint8Array(32).fill(7)),
    vault: {
      put: () => Promise.reject(new Error("unused")),
      get: () => Promise.reject(new Error("unused")),
      replace: () => Promise.reject(new Error("unused")),
      remove: () => Promise.reject(new Error("unused")),
    },
    audit: { append: () => Promise.resolve() },
  });
}

describe("data gateway boundary", () => {
  it("exposes health without exposing data operations", async () => {
    expect((await gateway().request("/health")).status).toBe(200);
  });

  it("rejects missing and invalid signed runtime contexts", async () => {
    expect((await gateway().request("/v1/managed/list", { method: "POST" })).status).toBe(401);
    expect(
      (
        await gateway().request("/v1/managed/list", {
          method: "POST",
          headers: { authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
  });
});
