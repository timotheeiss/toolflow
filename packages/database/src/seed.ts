import {
  organizationBranding,
  organizationMemberships,
  organizations,
  runtimeVersions,
  users,
} from "./schema.js";
import { createDatabase } from "./client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const developmentIds = {
  userId: "00000000-0000-4000-8000-000000000001",
  membershipId: "00000000-0000-4000-8000-000000000002",
  organizationId: "00000000-0000-4000-8000-000000000003",
  runtimeVersionId: "00000000-0000-4000-8000-000000000004",
} as const;

const database = createDatabase(connectionString);

try {
  await database.db.transaction(async (transaction) => {
    await transaction
      .insert(organizations)
      .values({
        id: developmentIds.organizationId,
        externalIdentityId: "development-organization",
        slug: "development",
        name: "Toolflow Development",
      })
      .onConflictDoNothing();
    await transaction
      .insert(users)
      .values({
        id: developmentIds.userId,
        externalIdentityId: "development-admin",
        email: "admin@toolflow.local",
        name: "Development Admin",
      })
      .onConflictDoNothing();
    await transaction
      .insert(organizationMemberships)
      .values({
        id: developmentIds.membershipId,
        organizationId: developmentIds.organizationId,
        userId: developmentIds.userId,
        role: "admin",
        status: "active",
        invitedEmail: "admin@toolflow.local",
      })
      .onConflictDoNothing();
    await transaction
      .insert(organizationBranding)
      .values({
        organizationId: developmentIds.organizationId,
        displayName: "Toolflow Development",
        primaryColor: "#214D3B",
        designGuidance: "Use concise labels, compact layouts, and clear operational states.",
      })
      .onConflictDoNothing();
    await transaction
      .insert(runtimeVersions)
      .values({
        id: developmentIds.runtimeVersionId,
        name: "toolflow-react",
        version: "1.0.1-development",
        sourceHash: "development-template-jsx-automatic",
        dependencyLockHash: "development-lockfile",
        compatibilityDate: "2026-08-10",
        active: true,
      })
      .onConflictDoUpdate({
        target: runtimeVersions.id,
        set: {
          version: "1.0.1-development",
          sourceHash: "development-template-jsx-automatic",
          dependencyLockHash: "development-lockfile",
          compatibilityDate: "2026-08-10",
          active: true,
        },
      });
  });
} finally {
  await database.close();
}
