import type { OrganizationRole } from "@toolflow/contracts";

export interface Principal {
  userId: string;
  membershipId: string;
  organizationId: string;
  role: OrganizationRole;
  sessionId?: string;
  clientId?: string;
}

export interface MembershipIdentityRepository {
  findActiveByExternalIdentity(
    externalUserId: string,
    externalOrganizationId: string,
  ): Promise<Omit<Principal, "sessionId" | "clientId"> | null>;
}
