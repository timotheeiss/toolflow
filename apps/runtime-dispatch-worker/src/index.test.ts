import { describe, expect, it, vi } from "vitest";
import {
  handleDispatchRequest,
  type DispatchEnvironment,
  type DispatchNamespace,
} from "./index.js";

const routeKey = "00000000-0000-4000-8000-000000000007";
const appUrl = `https://${routeKey}.apps.toolflow.test/`;
const grant = {
  allowed: true as const,
  routeKey,
  scriptName: "tf-preview-00000000-0000-4000-8000-000000000006",
  organizationId: "00000000-0000-4000-8000-000000000003",
  appId: "00000000-0000-4000-8000-000000000004",
  deploymentId: "00000000-0000-4000-8000-000000000006",
  environment: "preview" as const,
  requestId: "request-id",
  traceId: "0123456789abcdef0123456789abcdef",
  actorHash: "a".repeat(64),
  runtimeContextToken: "r".repeat(32),
  publicContext: {
    userId: "user",
    name: "User",
    email: "user@example.com",
    appId: "00000000-0000-4000-8000-000000000004",
    environment: "preview" as const,
    dataPath: "/__toolflow/data",
  },
};

function environment(overrides: Partial<DispatchEnvironment> = {}) {
  const dispatchedFetch = vi.fn<(request: Request) => Promise<Response>>(() =>
    Promise.resolve(new Response("app")),
  );
  const get = vi.fn<DispatchNamespace["get"]>(() => ({ fetch: dispatchedFetch }));
  const platformFetch = vi.fn<(request: Request) => Promise<Response>>((request) =>
    Promise.resolve(
      new URL(request.url).pathname === "/internal/authorize-runtime"
        ? Response.json(grant)
        : Response.json({ rows: [] }),
    ),
  );
  const limit = vi.fn(() => Promise.resolve({ success: true }));
  return {
    value: {
      TOOLFLOW_USER_WORKERS: { get },
      TOOLFLOW_RUNTIME_RATE_LIMITER: { limit },
      TOOLFLOW_PLATFORM_FETCH: { fetch: platformFetch },
      TOOLFLOW_AUTHORIZATION_ORIGIN: "https://authorization.toolflow.test",
      TOOLFLOW_AUTHORIZATION_SERVICE_TOKEN: "s".repeat(32),
      TOOLFLOW_APP_BASE_HOST: "apps.toolflow.test",
      TOOLFLOW_HEALTH_SERVICE_TOKEN: "h".repeat(32),
      TOOLFLOW_DATA_GATEWAY_ORIGIN: "https://data.toolflow.test",
      ...overrides,
    } satisfies DispatchEnvironment,
    get,
    dispatchedFetch,
    platformFetch,
    limit,
  };
}

describe("production dispatch worker", () => {
  it("authorizes before dispatch and binds outbound identity outside the user request", async () => {
    const fixture = environment();
    const response = await handleDispatchRequest(
      new Request(appUrl, { headers: { "x-toolflow-spoofed": "attacker" } }),
      fixture.value,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(200);
    expect(fixture.get).toHaveBeenCalledOnce();
    const dispatchCall = fixture.get.mock.calls[0];
    expect(dispatchCall?.[0]).toBe(grant.scriptName);
    expect(dispatchCall?.[2]?.limits).toEqual({ cpuMs: 50, subRequests: 10 });
    expect(dispatchCall?.[2]?.outbound?.TOOLFLOW_RUNTIME_CONTEXT_TOKEN).toBe(
      grant.runtimeContextToken,
    );
    const forwarded = fixture.dispatchedFetch.mock.calls[0]?.[0];
    expect(forwarded?.headers.get("x-toolflow-spoofed")).toBeNull();
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(forwarded?.headers.get("x-toolflow-public-context")).toBeTruthy();
  });

  it("sends SDK data requests only to the gateway service binding", async () => {
    const fixture = environment();
    const response = await handleDispatchRequest(
      new Request(`${appUrl}__toolflow/data/managed/list`, { method: "POST", body: "{}" }),
      fixture.value,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(200);
    expect(fixture.platformFetch).toHaveBeenCalledTimes(3);
    expect(fixture.get).not.toHaveBeenCalled();
  });

  it("returns a generic not-found response when authorization is denied or malformed", async () => {
    const fixture = environment({
      TOOLFLOW_PLATFORM_FETCH: {
        fetch: vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
      },
    });
    const response = await handleDispatchRequest(new Request(appUrl), fixture.value, {
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(404);
    expect(fixture.get).not.toHaveBeenCalled();
  });

  it("rejects a trusted grant bound to another app route", async () => {
    const fixture = environment({
      TOOLFLOW_PLATFORM_FETCH: {
        fetch: vi.fn((request: Request) =>
          Promise.resolve(
            new URL(request.url).pathname === "/internal/authorize-runtime"
              ? Response.json({
                  ...grant,
                  routeKey: "00000000-0000-4000-8000-000000000008",
                })
              : Response.json({ rows: [] }),
          ),
        ),
      },
    });
    const response = await handleDispatchRequest(new Request(appUrl), fixture.value, {
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(404);
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.limit).not.toHaveBeenCalled();
  });

  it("resolves only an exact persisted route-key subdomain", async () => {
    const fixture = environment();
    const response = await handleDispatchRequest(
      new Request(`https://${routeKey}.apps.toolflow.test.attacker.example/`),
      fixture.value,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(404);
    expect(fixture.platformFetch).not.toHaveBeenCalled();
    expect(fixture.get).not.toHaveBeenCalled();
  });

  it("enforces configurable execution and response limits around user code", async () => {
    const fixture = environment({
      TOOLFLOW_RUNTIME_CPU_MS: "25",
      TOOLFLOW_RUNTIME_SUBREQUESTS: "4",
      TOOLFLOW_RUNTIME_MAX_RESPONSE_BYTES: "1024",
    });
    fixture.dispatchedFetch.mockResolvedValue(new Response("x".repeat(1_025)));
    const response = await handleDispatchRequest(new Request(appUrl), fixture.value, {
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "APP_RESPONSE_TOO_LARGE" });
    expect(fixture.get.mock.calls[0]?.[2]?.limits).toEqual({ cpuMs: 25, subRequests: 4 });
  });

  it("enforces a distributed organization-and-actor quota before user code", async () => {
    const fixture = environment();
    fixture.limit.mockResolvedValue({ success: false });
    const response = await handleDispatchRequest(new Request(appUrl), fixture.value, {
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(fixture.limit).toHaveBeenCalledWith({
      key: `${grant.organizationId}:${grant.actorHash}`,
    });
    expect(fixture.get).not.toHaveBeenCalled();
  });

  it("privately invokes the uploaded Worker health route", async () => {
    const fixture = environment();
    fixture.dispatchedFetch.mockResolvedValue(Response.json({ status: "ok" }));
    const response = await handleDispatchRequest(
      new Request("https://apps.toolflow.test/internal/health", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"h".repeat(32)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ scriptName: grant.scriptName }),
      }),
      fixture.value,
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ health: "passed", scriptName: grant.scriptName });
  });
});
