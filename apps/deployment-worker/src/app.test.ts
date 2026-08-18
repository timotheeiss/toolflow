import { createHash } from "node:crypto";
import type { ToolflowArtifact } from "@toolflow/build-system";
import { describe, expect, it, vi } from "vitest";
import { createDeploymentWorker } from "./app.js";
import { buildUserWorkerModule } from "./provider.js";

const artifact: ToolflowArtifact = {
  version: 1,
  sourceHash: "source",
  runtimeVersion: "runtime",
  manifest: {
    manifestVersion: 1,
    name: "App",
    runtime: "toolflow-react-v1",
    capabilities: [],
    schema: { tables: [] },
    routes: [{ path: "/" }],
    healthcheck: "/api/health",
  },
  html: "<html></html>",
  clientJavaScript: "console.log('app')",
  clientCss: "",
  serverJavaScript: "export default {fetch(){return new Response('ok')}}",
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

describe("deployment worker", () => {
  it("requires its narrow internal service token", async () => {
    const app = createDeploymentWorker({ publish: vi.fn() }, "s".repeat(32));
    expect((await app.request("/v1/publish", { method: "POST" })).status).toBe(401);
  });

  it("verifies the immutable artifact hash before publishing", async () => {
    const publish = vi.fn(() => Promise.resolve({ providerDeploymentId: "provider:id" }));
    const app = createDeploymentWorker({ publish }, "s".repeat(32));
    const artifactHash = createHash("sha256").update(stableJson(artifact)).digest("hex");
    const response = await app.request("/v1/publish", {
      method: "POST",
      headers: { authorization: `Bearer ${"s".repeat(32)}`, "content-type": "application/json" },
      body: JSON.stringify({
        deploymentId: "00000000-0000-4000-8000-000000000001",
        organizationId: "00000000-0000-4000-8000-000000000002",
        appId: "00000000-0000-4000-8000-000000000003",
        appSlug: "test-app",
        environment: "preview",
        artifactHash,
        artifact,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providerDeploymentId: "provider:id",
      health: "passed",
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it("wraps the user server without leaking dispatcher identity headers", () => {
    const module = buildUserWorkerModule(artifact);
    expect(module).toContain('import userServer from "./user-server.js"');
    expect(module).toContain('startsWith("x-toolflow-")');
    expect(module).toContain("content-security-policy");
    expect(module).toContain("x-toolflow-public-context");
    expect(module).toContain("window.__TOOLFLOW_CONTEXT__");
    expect(module).toContain("nonce-");
    expect(module).not.toContain("'unsafe-inline'");
  });
});
