import type { ToolflowArtifact } from "@toolflow/build-system";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpRuntimePublisher,
  LocalRuntimePublisher,
  type RuntimePublishInput,
} from "./publisher.js";

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
  clientJavaScript: "export {}",
  clientCss: "",
  serverJavaScript: "export default {}",
};

const input: RuntimePublishInput = {
  deploymentId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  appId: "00000000-0000-4000-8000-000000000003",
  appSlug: "app",
  environment: "preview",
  artifactHash: "a".repeat(64),
  artifact,
};

afterEach(() => vi.unstubAllGlobals());

describe("runtime publishers", () => {
  it("rejects an incomplete local artifact before activation", async () => {
    const publisher = new LocalRuntimePublisher();
    await expect(
      publisher.publish({ ...input, artifact: { ...artifact, serverJavaScript: "" } }),
    ).rejects.toThrow("preflight");
  });

  it("requires the isolated deployment service to report a passed health probe", async () => {
    const publish = vi.fn<typeof fetch>((resource, init) => {
      const request = new Request(resource, init);
      expect(request.headers.get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
      return Promise.resolve(
        Response.json({ providerDeploymentId: "provider:id", health: "passed" }),
      );
    });
    vi.stubGlobal("fetch", publish);
    await expect(
      new HttpRuntimePublisher("https://deployment.toolflow.test", "s".repeat(32)).publish(input),
    ).resolves.toEqual({ providerDeploymentId: "provider:id", health: "passed" });
    expect(publish).toHaveBeenCalledOnce();
  });
});
