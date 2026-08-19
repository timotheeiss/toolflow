import type { MembershipIdentityRepository } from "@toolflow/auth";
import {
  organizationMemberships,
  organizations,
  users,
  and,
  eq,
  type ToolflowDatabase,
} from "@toolflow/database";

export class DatabaseMembershipIdentityRepository implements MembershipIdentityRepository {
  constructor(private readonly database: ToolflowDatabase["db"]) {}

  async findActiveByExternalIdentity(externalUserId: string, externalOrganizationId: string) {
    const rows = await this.database
      .select({
        userId: users.id,
        membershipId: organizationMemberships.id,
        organizationId: organizations.id,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(users.externalIdentityId, externalUserId),
          eq(organizations.externalIdentityId, externalOrganizationId),
          eq(organizations.status, "active"),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
