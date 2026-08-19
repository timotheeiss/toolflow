import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolflowArtifact } from "@toolflow/build-system";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeploymentWorker } from "./app.js";
import {
  buildUserWorkerModule,
  CloudflareDeploymentProvider,
  DeploymentProviderError,
} from "./provider.js";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("returns safe provider-stage diagnostics instead of hiding publication failures", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createDeploymentWorker(
      {
        publish: vi.fn(() =>
          Promise.reject(
            new DeploymentProviderError(
              "RUNTIME_HEALTH_REQUEST_FAILED",
              "The runtime health endpoint could not be reached.",
            ),
          ),
        ),
      },
      "s".repeat(32),
    );
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
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "RUNTIME_HEALTH_REQUEST_FAILED",
      message: "The runtime health endpoint could not be reached.",
    });
    expect(report).toHaveBeenCalledOnce();
  });

  it("distinguishes a runtime health network failure from a Cloudflare upload failure", async () => {
    const publish = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ success: true, result: { id: "script", startup_time_ms: 1 } }),
      )
      .mockRejectedValueOnce(new TypeError("host lookup failed"));
    vi.stubGlobal("fetch", publish);
    const provider = new CloudflareDeploymentProvider(
      "account",
      "token",
      { preview: "preview", production: "production" },
      { url: "https://runtime-health.toolflow.test/internal/health", token: "s".repeat(32) },
    );
    await expect(
      provider.publish({
        deploymentId: "00000000-0000-4000-8000-000000000001",
        environment: "preview",
        artifactHash: "a".repeat(64),
        artifact,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_HEALTH_REQUEST_FAILED" });
    expect(publish).toHaveBeenCalledTimes(2);
    const upload = publish.mock.calls[0]?.[1];
    const uploadBody = upload?.body as FormData;
    const metadata = uploadBody.get("metadata") as Blob;
    expect(JSON.parse(await metadata.text())).toEqual({
      main_module: "main.js",
      compatibility_date: "2026-08-01",
      bindings: [],
    });
  });

  it("retains Cloudflare validation text for internal diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              success: false,
              errors: [{ code: 100328, message: "Account setting rejected the upload." }],
            },
            { status: 400 },
          ),
        ),
      ),
    );
    const provider = new CloudflareDeploymentProvider(
      "account",
      "token",
      { preview: "preview", production: "production" },
      { url: "https://runtime-health.toolflow.test/internal/health", token: "s".repeat(32) },
    );
    const failure = await provider
      .publish({
        deploymentId: "00000000-0000-4000-8000-000000000001",
        environment: "preview",
        artifactHash: "a".repeat(64),
        artifact,
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "CLOUDFLARE_UPLOAD_FAILED",
      cause: { message: "[100328] Account setting rejected the upload." },
    });
  });

  it("retains a failed runtime health response for internal diagnostics", async () => {
    const publish = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ success: true, result: { id: "script", startup_time_ms: 1 } }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { code: "USER_WORKER_NOT_FOUND", message: "Worker namespace mismatch." },
          { status: 502 },
        ),
      );
    vi.stubGlobal("fetch", publish);
    const provider = new CloudflareDeploymentProvider(
      "account",
      "token",
      { preview: "preview", production: "production" },
      { url: "https://runtime-health.toolflow.test/internal/health", token: "s".repeat(32) },
    );
    const failure = await provider
      .publish({
        deploymentId: "00000000-0000-4000-8000-000000000001",
        environment: "preview",
        artifactHash: "a".repeat(64),
        artifact,
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "RUNTIME_HEALTH_CHECK_FAILED",
      cause: { message: "USER_WORKER_NOT_FOUND: Worker namespace mismatch." },
    });
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

  it("serves the authenticated platform health probe without app route participation", async () => {
    const directory = join(tmpdir(), `toolflow-worker-module-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    try {
      await Promise.all([
        writeFile(join(directory, "main.mjs"), buildUserWorkerModule(artifact)),
        writeFile(
          join(directory, "user-server.js"),
          'export default {fetch(){return new Response("app health is broken",{status:503})}}',
        ),
        writeFile(join(directory, "package.json"), '{"type":"module"}'),
      ]);
      const worker = (await import(pathToFileURL(join(directory, "main.mjs")).href)) as {
        default: { fetch(request: Request): Promise<Response> };
      };
      const response = await worker.default.fetch(
        new Request("https://toolflow.internal/api/health", {
          headers: { "x-toolflow-health-probe": "true" },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
