import {
  organizationBranding,
  organizationMemberships,
  organizations,
  runtimeVersions,
  users,
} from "./schema.js";
import { createDatabase } from "./client.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const organizationExternalId = process.env.TOOLFLOW_INITIAL_WORKOS_ORGANIZATION_ID;
const organizationSlug = process.env.TOOLFLOW_INITIAL_ORGANIZATION_SLUG;
const organizationName = process.env.TOOLFLOW_INITIAL_ORGANIZATION_NAME;
const adminEmail = process.env.TOOLFLOW_INITIAL_ADMIN_EMAIL?.toLowerCase();
const adminName = process.env.TOOLFLOW_INITIAL_ADMIN_NAME;

if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) is required.");
if (!organizationExternalId || !organizationSlug || !organizationName || !adminEmail || !adminName) {
  throw new Error(
    "TOOLFLOW_INITIAL_WORKOS_ORGANIZATION_ID, TOOLFLOW_INITIAL_ORGANIZATION_SLUG, TOOLFLOW_INITIAL_ORGANIZATION_NAME, TOOLFLOW_INITIAL_ADMIN_EMAIL, and TOOLFLOW_INITIAL_ADMIN_NAME are required.",
  );
}

const database = createDatabase(databaseUrl, { max: 1 });

try {
  await database.db.transaction(async (transaction) => {
    const [organization] = await transaction
      .insert(organizations)
      .values({
        externalIdentityId: organizationExternalId,
        slug: organizationSlug,
        name: organizationName,
      })
      .onConflictDoUpdate({
        target: organizations.externalIdentityId,
        set: { slug: organizationSlug, name: organizationName, updatedAt: new Date() },
      })
      .returning();
    if (!organization) throw new Error("Organization bootstrap failed.");

    const [user] = await transaction
      .insert(users)
      .values({ email: adminEmail, name: adminName })
      .onConflictDoUpdate({ target: users.email, set: { name: adminName, updatedAt: new Date() } })
      .returning();
    if (!user) throw new Error("Administrator bootstrap failed.");

    await transaction
      .insert(organizationMemberships)
      .values({
        organizationId: organization.id,
        userId: user.id,
        role: "admin",
        status: "invited",
        invitedEmail: adminEmail,
      })
      .onConflictDoUpdate({
        target: [organizationMemberships.organizationId, organizationMemberships.userId],
        set: { role: "admin", status: "invited", invitedEmail: adminEmail, updatedAt: new Date() },
      });

    await transaction
      .insert(organizationBranding)
      .values({ organizationId: organization.id, displayName: organizationName })
      .onConflictDoNothing();

    await transaction.update(runtimeVersions).set({ active: false });
    await transaction
      .insert(runtimeVersions)
      .values({
        name: "toolflow-react",
        version: "1.0.1-pilot",
        sourceHash: "pilot-template-jsx-automatic",
        dependencyLockHash: "pilot-lockfile",
        compatibilityDate: "2026-08-10",
        active: true,
      })
      .onConflictDoUpdate({
        target: [runtimeVersions.name, runtimeVersions.version],
        set: { active: true },
      });
  });
} finally {
  await database.close();
}
