import { describe, expect, it } from "vitest";
import { createToolflowServer } from "./index.js";

describe("generated app server", () => {
  it("provides the platform health endpoint", async () => {
    const app = createToolflowServer({ health: "/api/health" });
    expect(await (await app.request("/api/health")).json()).toEqual({ status: "ok" });
  });
});
