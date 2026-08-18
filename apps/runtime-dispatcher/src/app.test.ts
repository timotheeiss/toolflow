import type { ToolflowDatabase } from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { RuntimeContextSigner } from "@toolflow/runtime-context";
import { describe, expect, it } from "vitest";
import { brandingCss, createRuntimeDispatcher } from "./app.js";

function dispatcher(serviceToken?: string) {
  return createRuntimeDispatcher({
    database: {} as ToolflowDatabase["db"],
    objects: {} as ImmutableObjectStore,
    authenticator: { authenticate: () => Promise.resolve(null) },
    audit: { append: () => Promise.resolve() },
    runtimeContextSigner: {} as RuntimeContextSigner,
    dataGatewayUrl: "https://data.toolflow.test",
    ...(serviceToken ? { authorizationServiceToken: serviceToken } : {}),
  });
}

describe("runtime authorization boundary", () => {
  it("uses the normalized accessible foreground for light and dark branding", () => {
    expect(brandingCss("#FFFFFF")).toContain("--tf-on-primary:#000000");
    expect(brandingCss("#000000")).toContain("--tf-on-primary:#FFFFFF");
    expect(brandingCss("#FFFFFF")).toContain("color:var(--tf-on-primary)");
  });

  it("keeps health independent from app authentication", async () => {
    expect((await dispatcher().request("/health")).status).toBe(200);
  });

  it("requires the narrow service credential before user authentication", async () => {
    const app = dispatcher("s".repeat(32));
    expect((await app.request("/internal/authorize-runtime", { method: "POST" })).status).toBe(401);
    const authenticatedService = await app.request("/internal/authorize-runtime", {
      method: "POST",
      headers: { "x-toolflow-service-authorization": "s".repeat(32) },
    });
    expect(authenticatedService.status).toBe(403);
  });

  it("protects runtime usage ingestion with the same narrow service credential", async () => {
    const app = dispatcher("s".repeat(32));
    expect((await app.request("/internal/runtime-usage", { method: "POST" })).status).toBe(401);
  });
});
