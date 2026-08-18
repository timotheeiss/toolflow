import type { AccessTokenVerifier, MembershipIdentityRepository, Principal } from "@toolflow/auth";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

export interface AuthenticatedMcpPrincipal extends Principal {
  scopes: string[];
}

export class ToolflowOAuthTokenVerifier implements OAuthTokenVerifier {
  constructor(
    private readonly tokenVerifier: AccessTokenVerifier,
    private readonly memberships: MembershipIdentityRepository,
    private readonly resource: URL,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const identity = await this.tokenVerifier.verify(token);
      const membership = await this.memberships.findActiveByExternalIdentity(
        identity.externalUserId,
        identity.externalOrganizationId,
      );
      if (!membership || !identity.expiresAt) throw new Error("Membership or expiry is missing.");
      const principal: AuthenticatedMcpPrincipal = {
        ...membership,
        ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
        ...(identity.clientId ? { clientId: identity.clientId } : {}),
        scopes: identity.scopes ?? [],
      };
      return {
        token,
        clientId: identity.clientId ?? identity.externalUserId,
        scopes: principal.scopes,
        expiresAt: identity.expiresAt,
        resource: this.resource,
        extra: { principal },
      };
    } catch {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or revoked.");
    }
  }
}

export class DevelopmentAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly token = "development-token") {}

  verify(accessToken: string) {
    if (accessToken !== this.token) return Promise.reject(new Error("Invalid development token."));
    return Promise.resolve({
      externalUserId: "development-admin",
      externalOrganizationId: "development-organization",
      sessionId: "development-mcp-session",
      clientId: "development-mcp-client",
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      scopes: ["toolflow:mcp", "toolflow:read", "toolflow:write", "toolflow:deploy"],
    });
  }
}

export function principalFromAuthInfo(authInfo: AuthInfo | undefined): AuthenticatedMcpPrincipal {
  const principal = authInfo?.extra?.principal;
  if (!principal || typeof principal !== "object")
    throw new Error("Authenticated principal missing.");
  return principal as AuthenticatedMcpPrincipal;
}
