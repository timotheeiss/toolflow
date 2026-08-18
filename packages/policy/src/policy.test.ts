import { describe, expect, it } from "vitest";
import { canManageApp, roleCan, type Permission } from "./index.js";

describe("role policy", () => {
  const allPermissions: Permission[] = [
    "organization:read",
    "users:manage",
    "branding:manage",
    "connections:manage",
    "catalog:manage",
    "apps:create",
    "apps:edit:any",
    "apps:edit:owned",
    "previews:deploy",
    "production:deploy",
    "members:manage:any",
    "members:manage:owned",
    "apps:disable",
    "audit:read:any",
    "audit:read:owned",
  ];

  it.each([
    {
      role: "admin" as const,
      allowed: [
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
      ] satisfies Permission[],
    },
    {
      role: "builder" as const,
      allowed: [
        "organization:read",
        "apps:create",
        "apps:edit:owned",
        "previews:deploy",
        "production:deploy",
        "members:manage:owned",
        "audit:read:owned",
      ] satisfies Permission[],
    },
    { role: "member" as const, allowed: [] satisfies Permission[] },
  ])("enforces the complete deny-by-default $role permission matrix", ({ role, allowed }) => {
    const expected = new Set<Permission>(allowed);
    for (const permission of allPermissions) {
      expect(roleCan(role, permission), `${role}:${permission}`).toBe(expected.has(permission));
    }
  });

  it("allows admins to manage users and denies builders", () => {
    expect(roleCan("admin", "users:manage")).toBe(true);
    expect(roleCan("builder", "users:manage")).toBe(false);
  });

  it("allows builders to edit only owned apps", () => {
    expect(canManageApp("builder", "membership-1", ["membership-1"])).toBe(true);
    expect(canManageApp("builder", "membership-2", ["membership-1"])).toBe(false);
  });
});
