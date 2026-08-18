import type { OrganizationRole } from "@toolflow/contracts";

export type Permission =
  | "organization:read"
  | "users:manage"
  | "branding:manage"
  | "connections:manage"
  | "catalog:manage"
  | "apps:create"
  | "apps:edit:any"
  | "apps:edit:owned"
  | "previews:deploy"
  | "production:deploy"
  | "members:manage:any"
  | "members:manage:owned"
  | "apps:disable"
  | "audit:read:any"
  | "audit:read:owned";

const permissions: Readonly<Record<OrganizationRole, ReadonlySet<Permission>>> = {
  admin: new Set([
    "organization:read",
    "users:manage",
    "branding:manage",
    "connections:manage",
    "catalog:manage",
    "apps:create",
    "apps:edit:any",
    "previews:deploy",
    "production:deploy",
    "members:manage:any",
    "apps:disable",
    "audit:read:any",
  ]),
  builder: new Set([
    "organization:read",
    "apps:create",
    "apps:edit:owned",
    "previews:deploy",
    "production:deploy",
    "members:manage:owned",
    "audit:read:owned",
  ]),
  member: new Set(),
};

export function roleCan(role: OrganizationRole, permission: Permission): boolean {
  return permissions[role].has(permission);
}

export function canManageApp(
  role: OrganizationRole,
  actorMembershipId: string,
  ownerMembershipIds: readonly string[],
): boolean {
  return (
    roleCan(role, "apps:edit:any") ||
    (roleCan(role, "apps:edit:owned") && ownerMembershipIds.includes(actorMembershipId))
  );
}
