import type { Principal, RequestAuthenticator } from "@toolflow/auth";
import { organizationMemberships, users, type ToolflowDatabase } from "@toolflow/database";
import { and, eq } from "drizzle-orm";

export class DevelopmentRuntimeAuthenticator implements RequestAuthenticator {
  constructor(
    private readonly database: ToolflowDatabase["db"],
    private readonly principal: Principal,
  ) {}

  async authenticate(request: Request): Promise<Principal | null> {
    const requested = {
      userId: request.headers.get("x-toolflow-dev-user-id"),
      membershipId: request.headers.get("x-toolflow-dev-membership-id"),
      organizationId: request.headers.get("x-toolflow-dev-organization-id"),
    };
    const selected: Pick<Principal, "userId" | "membershipId" | "organizationId"> =
      requested.userId && requested.membershipId && requested.organizationId
        ? {
            userId: requested.userId,
            membershipId: requested.membershipId,
            organizationId: requested.organizationId,
          }
        : this.principal;
    const rows = await this.database
      .select({
        userId: users.id,
        membershipId: organizationMemberships.id,
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.id, selected.membershipId),
          eq(organizationMemberships.organizationId, selected.organizationId),
          eq(users.id, selected.userId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    return rows[0] ? { ...rows[0], sessionId: "development-runtime-session" } : null;
  }
}
