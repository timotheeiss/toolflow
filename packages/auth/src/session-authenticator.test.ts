import { describe, expect, it } from "vitest";
import { WorkOsSessionAuthenticator, cookieValue } from "./session-authenticator.js";

const membership = {
  userId: "00000000-0000-4000-8000-000000000001",
  membershipId: "00000000-0000-4000-8000-000000000002",
  organizationId: "00000000-0000-4000-8000-000000000003",
  role: "admin" as const,
};

describe("WorkOsSessionAuthenticator", () => {
  it("maps verified WorkOS claims to an active internal membership", async () => {
    const authenticator = new WorkOsSessionAuthenticator(
      {
        userManagement: {
          loadSealedSession: () => ({
            authenticate: () =>
              Promise.resolve({
                authenticated: true,
                user: { id: "workos-user" },
                organizationId: "workos-org",
                sessionId: "session-1",
              }),
            refresh: () => Promise.resolve({ authenticated: false }),
          }),
        },
      },
      {
        findActiveByExternalIdentity: () => Promise.resolve(membership),
      },
      "a".repeat(32),
    );
    const result = await authenticator.authenticateRequest(
      new Request("https://toolflow.test/v1/me", { headers: { cookie: "wos_session=sealed" } }),
    );
    expect(result?.principal).toEqual({ ...membership, sessionId: "session-1" });
  });

  it("refreshes expired access and rotates the sealed cookie", async () => {
    const authenticator = new WorkOsSessionAuthenticator(
      {
        userManagement: {
          loadSealedSession: () => ({
            authenticate: () => Promise.resolve({ authenticated: false, reason: "invalid_jwt" }),
            refresh: () =>
              Promise.resolve({
                authenticated: true,
                user: { id: "workos-user" },
                organizationId: "workos-org",
                sessionId: "session-2",
                sealedSession: "rotated",
              }),
          }),
        },
      },
      { findActiveByExternalIdentity: () => Promise.resolve(membership) },
      "a".repeat(32),
    );
    const result = await authenticator.authenticateRequest(
      new Request("https://toolflow.test", { headers: { cookie: "wos_session=expired" } }),
    );
    expect(result?.setCookieHeader).toContain("wos_session=rotated");
    expect(result?.setCookieHeader).toContain("HttpOnly");
  });

  it("parses exact cookie names", () => {
    expect(cookieValue("other=1; wos_session=sealed%2Avalue", "wos_session")).toBe("sealed*value");
  });
});

describe("session cookie domains", () => {
  it("shares a production session across configured subdomains", () => {
    const authenticator = new WorkOsSessionAuthenticator(
      { userManagement: { loadSealedSession: () => ({ authenticate: async () => ({ authenticated: false }), refresh: async () => ({ authenticated: false }) }) } },
      { findActiveByExternalIdentity: async () => null },
      "c".repeat(32),
      { domain: ".toolflow.space" },
    );
    expect(authenticator.sessionCookie("sealed")).toContain("Domain=.toolflow.space");
  });
});
