import { afterEach, describe, expect, it, vi } from "vitest";
import { handleOutboundRequest, type OutboundEnvironment } from "./index.js";

const baseEnvironment: OutboundEnvironment = {
  TOOLFLOW_DATA_GATEWAY_ORIGIN: "https://data.toolflow.test",
  TOOLFLOW_RUNTIME_CONTEXT_TOKEN: "bound-token",
  TOOLFLOW_DISPATCH_CONTEXT: JSON.stringify({
    organizationId: "org",
    appId: "app",
    deploymentId: "deployment",
    environment: "preview",
    requestId: "request",
    traceId: "0123456789abcdef0123456789abcdef",
  }),
};

afterEach(() => vi.unstubAllGlobals());

describe("runtime outbound policy", () => {
  it("allows only an exact gateway origin and injects the trusted token", async () => {
    const upstream = vi.fn((request: Request) =>
      Promise.resolve(Response.json({ authorization: request.headers.get("authorization") })),
    );
    vi.stubGlobal("fetch", upstream);
    const response = await handleOutboundRequest(
      new Request("https://data.toolflow.test/v1/managed/list", {
        method: "POST",
        headers: { "x-toolflow-spoofed": "value" },
        body: "{}",
      }),
      baseEnvironment,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authorization: "Bearer bound-token" });
    const forwarded = upstream.mock.calls[0]?.[0];
    expect(forwarded?.headers.get("x-toolflow-spoofed")).toBeNull();
    expect(forwarded?.redirect).toBe("manual");
  });

  it("rejects prefix-confusion hosts without issuing a network request", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handleOutboundRequest(
      new Request("https://data.toolflow.test.attacker.example/v1/managed/list", {
        method: "POST",
        body: "{}",
      }),
      baseEnvironment,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EGRESS_DENIED" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects redirects and emits a redacted security event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 302 }))),
    );
    const audited: Request[] = [];
    const audit = (request: Request) => {
      audited.push(request);
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const waitUntil = vi.fn();
    const response = await handleOutboundRequest(
      new Request("https://data.toolflow.test/v1/external-query", {
        method: "POST",
        body: "{}",
      }),
      { ...baseEnvironment, TOOLFLOW_SECURITY_AUDIT: { fetch: audit } },
      { waitUntil },
    );
    expect(response.status).toBe(403);
    expect(waitUntil).toHaveBeenCalledOnce();
    const event: unknown = await audited[0]!.json();
    expect(event).toMatchObject({ reason: "redirect_rejected", appId: "app" });
    expect(JSON.stringify(event)).not.toContain("bound-token");
  });
});
