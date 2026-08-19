import { describe, expect, it, vi } from "vitest";
import { ToolflowOAuthTokenVerifier } from "./oauth-verifier.js";

describe("ToolflowOAuthTokenVerifier", () => {
  it("accepts an AuthKit token without Toolflow-specific OAuth scopes when its membership is active", async () => {
    const tokenVerifier = {
      verify: vi.fn().mockResolvedValue({
        externalUserId: "user_123",
        externalOrganizationId: "org_123",
        expiresAt: 1_800_000_000,
        scopes: ["openid", "profile", "email"],
      }),
    };
    const memberships = {
      findActiveByExternalIdentity: vi.fn().mockResolvedValue({
        userId: "toolflow-user",
        membershipId: "toolflow-membership",
        organizationId: "toolflow-organization",
        role: "admin" as const,
      }),
    };
    const verifier = new ToolflowOAuthTokenVerifier(
      tokenVerifier,
      memberships,
      new URL("https://mcp.toolflow.space/mcp"),
    );

    const result = await verifier.verifyAccessToken("access-token");

    expect(result.scopes).toEqual(["openid", "profile", "email"]);
    expect(memberships.findActiveByExternalIdentity).toHaveBeenCalledWith("user_123", "org_123");
  });
});
