import { randomUUID } from "node:crypto";
import { InMemoryAuditWriter } from "@toolflow/audit";
import { DevelopmentHeaderAuthenticator } from "@toolflow/auth";
import { describe, expect, it } from "vitest";
import { createControlApi } from "./app.js";
import { InMemoryAdminStore } from "./admin-store.js";
import type { AuthKitController } from "./authkit.js";
import type { GovernanceStore } from "./governance-store.js";
import { InMemoryRateLimiter } from "./rate-limit.js";

const developmentHeaders = {
  "x-toolflow-dev-user-id": randomUUID(),
  "x-toolflow-dev-membership-id": randomUUID(),
  "x-toolflow-dev-organization-id": randomUUID(),
  "x-toolflow-dev-role": "builder",
};

describe("control API", () => {
  const restrictedBuilderRequests = [
    ["POST", "/v1/users"],
    ["PATCH", `/v1/users/${randomUUID()}`],
    ["PATCH", "/v1/branding"],
    ["POST", "/v1/branding/logo"],
    ["PATCH", `/v1/apps/${randomUUID()}/state`],
    ["POST", "/v1/connections"],
    ["PATCH", `/v1/connections/${randomUUID()}`],
    ["POST", `/v1/connections/${randomUUID()}/test`],
    ["PATCH", `/v1/connections/${randomUUID()}/state`],
    ["DELETE", `/v1/connections/${randomUUID()}`],
    ["POST", `/v1/connections/${randomUUID()}/catalog-refresh`],
    ["PATCH", `/v1/catalog/${randomUUID()}`],
    ["GET", "/v1/audit/export.csv"],
  ] as const;

  it.each(restrictedBuilderRequests)(
    "denies a builder at the protected endpoint boundary: %s %s",
    async (method, path) => {
      const app = createControlApi({
        authenticator: new DevelopmentHeaderAuthenticator(),
        audit: new InMemoryAuditWriter(),
        adminStore: new InMemoryAdminStore(),
      });
      const response = await app.request(path, {
        method,
        headers: { ...developmentHeaders, "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    },
  );

  it.each([
    "/v1/overview",
    "/v1/users",
    "/v1/branding",
    "/v1/apps",
    `/v1/apps/${randomUUID()}`,
    `/v1/apps/${randomUUID()}/activity`,
    "/v1/connections",
    "/v1/catalog",
    "/v1/audit",
  ])("denies an app member access to the administration surface: GET %s", async (path) => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
    });
    const response = await app.request(path, {
      headers: { ...developmentHeaders, "x-toolflow-dev-role": "member" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it.each(["/v1/apps/:appId", "/v1/apps/:appId/activity", "/v1/audit?appId=:appId"])(
    "denies a builder access to a non-owned app: GET %s",
    async (pathTemplate) => {
      const appId = randomUUID();
      const governanceStore = {
        listApps: () => Promise.resolve([]),
      } as unknown as GovernanceStore;
      const app = createControlApi({
        authenticator: new DevelopmentHeaderAuthenticator(),
        audit: new InMemoryAuditWriter(),
        adminStore: new InMemoryAdminStore(),
        governanceStore,
      });
      const response = await app.request(pathTemplate.replaceAll(":appId", appId), {
        headers: developmentHeaders,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    },
  );

  it("returns health without authentication and supplies a request ID", async () => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
    });
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("denies protected routes without authentication", async () => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
    });
    const response = await app.request("/v1/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("does not expose the removed approval API", async () => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
    });
    const response = await app.request("/v1/approvals", { headers: developmentHeaders });
    expect(response.status).toBe(404);
  });

  it("returns the authenticated principal and audits the read", async () => {
    const audit = new InMemoryAuditWriter();
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit,
      adminStore: new InMemoryAdminStore(),
    });
    const response = await app.request("/v1/me", { headers: developmentHeaders });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ principal: { role: "builder" } });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe("identity.read");
  });

  it("allows configured browser origins without using a wildcard", async () => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
    const allowed = await app.request("/health", {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");

    const denied = await app.request("/health", {
      headers: { origin: "https://attacker.example" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows admins to invite users and rejects builders", async () => {
    const adminStore = new InMemoryAdminStore();
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore,
    });
    const builderResponse = await app.request("/v1/users", {
      method: "POST",
      headers: { ...developmentHeaders, "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });
    expect(builderResponse.status).toBe(403);

    const adminResponse = await app.request("/v1/users", {
      method: "POST",
      headers: {
        ...developmentHeaders,
        "x-toolflow-dev-role": "admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });
    expect(adminResponse.status).toBe(201);
    expect(adminStore.users[0]?.email).toBe("new@example.com");
  });

  it("prevents deactivation of the final active admin", async () => {
    const admin = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      name: "Admin",
      email: "admin@example.com",
      role: "admin" as const,
      status: "active" as const,
    };
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore({ users: [admin] }),
    });
    const response = await app.request(`/v1/users/${admin.membershipId}`, {
      method: "PATCH",
      headers: {
        ...developmentHeaders,
        "x-toolflow-dev-role": "admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "deactivated" }),
    });
    expect(response.status).toBe(409);
  });

  it("requires a matching CSRF token for cookie-authenticated mutations", async () => {
    const authKit = {
      hasSessionCookie: (request: Request) =>
        request.headers.get("cookie")?.includes("wos_session=") ?? false,
      validateCsrf: (request: Request) => request.headers.get("x-toolflow-csrf") === "known-token",
      csrfToken: () => "known-token",
    } as unknown as AuthKitController;
    const adminStore = new InMemoryAdminStore();
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore,
      authKit,
    });
    const headers = {
      ...developmentHeaders,
      "x-toolflow-dev-role": "admin",
      "content-type": "application/json",
      cookie: "wos_session=sealed; tf_csrf=known-token",
    };
    const denied = await app.request("/v1/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "csrf-denied@example.com", role: "member" }),
    });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/v1/users", {
      method: "POST",
      headers: { ...headers, "x-toolflow-csrf": "known-token" },
      body: JSON.stringify({ email: "csrf-allowed@example.com", role: "member" }),
    });
    expect(allowed.status).toBe(201);
  });

  it("enforces organization-and-actor-aware API rate limits", async () => {
    const app = createControlApi({
      authenticator: new DevelopmentHeaderAuthenticator(),
      audit: new InMemoryAuditWriter(),
      adminStore: new InMemoryAdminStore(),
      rateLimiter: new InMemoryRateLimiter(() => 1_000),
    });
    let response: Response | undefined;
    for (let index = 0; index < 601; index += 1) {
      response = await app.request("/v1/me", {
        headers: { ...developmentHeaders, "x-real-ip": `198.51.100.${index}` },
      });
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");

    const otherActor = await app.request("/v1/me", {
      headers: {
        ...developmentHeaders,
        "x-toolflow-dev-user-id": randomUUID(),
        "x-real-ip": "203.0.113.1",
      },
    });
    expect(otherActor.status).toBe(200);
  });
});
