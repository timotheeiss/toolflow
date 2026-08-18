import type { AccessTokenVerifier } from "./token-verifier.js";
import { bearerTokenFromRequest } from "./token-verifier.js";
import type { MembershipIdentityRepository, Principal } from "./principal.js";

export interface RequestAuthenticator {
  authenticate(request: Request): Promise<Principal | null>;
}

export class BearerRequestAuthenticator implements RequestAuthenticator {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly memberships: MembershipIdentityRepository,
  ) {}

  async authenticate(request: Request): Promise<Principal | null> {
    const token = bearerTokenFromRequest(request);
    if (!token) return null;
    const externalIdentity = await this.verifier.verify(token);
    const membership = await this.memberships.findActiveByExternalIdentity(
      externalIdentity.externalUserId,
      externalIdentity.externalOrganizationId,
    );
    if (!membership) return null;

    return {
      ...membership,
      ...(externalIdentity.sessionId ? { sessionId: externalIdentity.sessionId } : {}),
      ...(externalIdentity.clientId ? { clientId: externalIdentity.clientId } : {}),
    };
  }
}

export class DevelopmentHeaderAuthenticator implements RequestAuthenticator {
  authenticate(request: Request): Promise<Principal | null> {
    const userId = request.headers.get("x-toolflow-dev-user-id");
    const membershipId = request.headers.get("x-toolflow-dev-membership-id");
    const organizationId = request.headers.get("x-toolflow-dev-organization-id");
    const role = request.headers.get("x-toolflow-dev-role");
    if (!userId || !membershipId || !organizationId) return Promise.resolve(null);
    if (role !== "admin" && role !== "builder" && role !== "member") return Promise.resolve(null);

    return Promise.resolve({
      userId,
      membershipId,
      organizationId,
      role,
      sessionId: "development-session",
      clientId: "development-client",
    });
  }
}
