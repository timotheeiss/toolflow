import type {
  InviteUserInput,
  OrganizationBranding,
  OrganizationUser,
  UpdateBrandingInput,
  UpdateMembershipInput,
} from "@toolflow/contracts";
import {
  appOwners,
  apps,
  organizationBranding,
  organizationMemberships,
  users,
  and,
  count,
  eq,
  type ToolflowDatabase,
} from "@toolflow/database";
import { ControlApiError } from "./errors.js";

export interface AdminStore {
  listUsers(organizationId: string): Promise<OrganizationUser[]>;
  inviteUser(organizationId: string, input: InviteUserInput): Promise<OrganizationUser>;
  updateMembership(
    organizationId: string,
    membershipId: string,
    input: UpdateMembershipInput,
  ): Promise<OrganizationUser>;
  getBranding(organizationId: string): Promise<OrganizationBranding>;
  updateBranding(organizationId: string, input: UpdateBrandingInput): Promise<OrganizationBranding>;
}

export class DatabaseAdminStore implements AdminStore {
  constructor(private readonly database: ToolflowDatabase["db"]) {}

  async listUsers(organizationId: string): Promise<OrganizationUser[]> {
    return this.database
      .select({
        membershipId: organizationMemberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(users.name, users.email);
  }

  async inviteUser(organizationId: string, input: InviteUserInput): Promise<OrganizationUser> {
    return this.database.transaction(async (transaction) => {
      const existingMembership = await transaction
        .select({ membershipId: organizationMemberships.id })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(users.email, input.email),
          ),
        )
        .limit(1);
      if (existingMembership[0]) {
        throw new ControlApiError(
          409,
          "CONFLICT",
          "This email already belongs to the organization.",
        );
      }

      const existingUsers = await transaction
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      let user = existingUsers[0];
      if (!user) {
        [user] = await transaction
          .insert(users)
          .values({ email: input.email, name: input.email.split("@")[0] ?? input.email })
          .returning();
      }
      if (!user) throw new Error("User creation did not return a record.");

      const [membership] = await transaction
        .insert(organizationMemberships)
        .values({
          organizationId,
          userId: user.id,
          role: input.role,
          status: "invited",
          invitedEmail: input.email,
        })
        .returning();
      if (!membership) throw new Error("Membership creation did not return a record.");

      return {
        membershipId: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        status: membership.status,
      };
    });
  }

  async updateMembership(
    organizationId: string,
    membershipId: string,
    input: UpdateMembershipInput,
  ): Promise<OrganizationUser> {
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction
        .select({
          membership: organizationMemberships,
          user: users,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, membershipId),
          ),
        )
        .limit(1);
      const current = currentRows[0];
      if (!current)
        throw new ControlApiError(404, "NOT_FOUND", "Organization membership not found.");

      const removesActiveAdmin =
        current.membership.role === "admin" &&
        current.membership.status === "active" &&
        ((input.role !== undefined && input.role !== "admin") ||
          (input.status !== undefined && input.status !== "active"));
      if (removesActiveAdmin) {
        const [adminCount] = await transaction
          .select({ count: count() })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.role, "admin"),
              eq(organizationMemberships.status, "active"),
            ),
          );
        if ((adminCount?.count ?? 0) <= 1) {
          throw new ControlApiError(
            409,
            "CONFLICT",
            "The final active admin cannot be removed or demoted.",
          );
        }
      }

      const [membership] = await transaction
        .update(organizationMemberships)
        .set({
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, membershipId),
          ),
        )
        .returning();
      if (!membership) throw new Error("Membership update did not return a record.");

      if (input.status === "deactivated") {
        const ownedApps = await transaction
          .select({ appId: appOwners.appId })
          .from(appOwners)
          .where(eq(appOwners.membershipId, membershipId));
        for (const ownedApp of ownedApps) {
          const [activeOwnerCount] = await transaction
            .select({ count: count() })
            .from(appOwners)
            .innerJoin(
              organizationMemberships,
              eq(organizationMemberships.id, appOwners.membershipId),
            )
            .where(
              and(
                eq(appOwners.appId, ownedApp.appId),
                eq(organizationMemberships.status, "active"),
              ),
            );
          if ((activeOwnerCount?.count ?? 0) === 0) {
            await transaction
              .update(apps)
              .set({ lifecycle: "orphaned", updatedAt: new Date() })
              .where(and(eq(apps.organizationId, organizationId), eq(apps.id, ownedApp.appId)));
          }
        }
      }

      return {
        membershipId: membership.id,
        userId: current.user.id,
        name: current.user.name,
        email: current.user.email,
        role: membership.role,
        status: membership.status,
      };
    });
  }

  async getBranding(organizationId: string): Promise<OrganizationBranding> {
    const rows = await this.database
      .select()
      .from(organizationBranding)
      .where(eq(organizationBranding.organizationId, organizationId))
      .limit(1);
    const branding = rows[0];
    if (!branding) throw new ControlApiError(404, "NOT_FOUND", "Organization branding not found.");
    return branding;
  }

  async updateBranding(
    organizationId: string,
    input: UpdateBrandingInput,
  ): Promise<OrganizationBranding> {
    const [branding] = await this.database
      .update(organizationBranding)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(organizationBranding.organizationId, organizationId))
      .returning();
    if (!branding) throw new ControlApiError(404, "NOT_FOUND", "Organization branding not found.");
    return branding;
  }
}

export class InMemoryAdminStore implements AdminStore {
  readonly users: OrganizationUser[];
  branding: OrganizationBranding;

  constructor(options?: { users?: OrganizationUser[]; branding?: OrganizationBranding }) {
    this.users = options?.users ? [...options.users] : [];
    this.branding = options?.branding ?? {
      displayName: "Toolflow Test",
      logoObjectKey: null,
      primaryColor: "#2563EB",
      designGuidance: "",
    };
  }

  listUsers(): Promise<OrganizationUser[]> {
    return Promise.resolve([...this.users]);
  }

  inviteUser(_organizationId: string, input: InviteUserInput): Promise<OrganizationUser> {
    if (this.users.some((user) => user.email === input.email)) {
      return Promise.reject(
        new ControlApiError(409, "CONFLICT", "This email already belongs to the organization."),
      );
    }
    const user = {
      membershipId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      name: input.email.split("@")[0] ?? input.email,
      email: input.email,
      role: input.role,
      status: "invited" as const,
    };
    this.users.push(user);
    return Promise.resolve(user);
  }

  updateMembership(
    _organizationId: string,
    membershipId: string,
    input: UpdateMembershipInput,
  ): Promise<OrganizationUser> {
    const user = this.users.find((candidate) => candidate.membershipId === membershipId);
    if (!user) {
      return Promise.reject(
        new ControlApiError(404, "NOT_FOUND", "Organization membership not found."),
      );
    }
    const removesActiveAdmin =
      user.role === "admin" &&
      user.status === "active" &&
      ((input.role !== undefined && input.role !== "admin") ||
        (input.status !== undefined && input.status !== "active"));
    if (
      removesActiveAdmin &&
      this.users.filter((candidate) => candidate.role === "admin" && candidate.status === "active")
        .length <= 1
    ) {
      return Promise.reject(
        new ControlApiError(
          409,
          "CONFLICT",
          "The final active admin cannot be removed or demoted.",
        ),
      );
    }
    if (input.role !== undefined) user.role = input.role;
    if (input.status !== undefined) user.status = input.status;
    return Promise.resolve({ ...user });
  }

  getBranding(): Promise<OrganizationBranding> {
    return Promise.resolve({ ...this.branding });
  }

  updateBranding(
    _organizationId: string,
    input: UpdateBrandingInput,
  ): Promise<OrganizationBranding> {
    this.branding = {
      displayName: input.displayName ?? this.branding.displayName,
      logoObjectKey:
        input.logoObjectKey !== undefined ? input.logoObjectKey : this.branding.logoObjectKey,
      primaryColor: input.primaryColor ?? this.branding.primaryColor,
      designGuidance: input.designGuidance ?? this.branding.designGuidance,
    };
    return Promise.resolve({ ...this.branding });
  }
}
