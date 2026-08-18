import { createHash } from "node:crypto";
import {
  accessibleForeground,
  appManifestSchema,
  capabilityKey,
  type AppManifest,
  type SourceBundle,
  type SourceFile,
} from "@toolflow/contracts";
import {
  appDataSpaces,
  appMembers,
  appOwners,
  appRoutes,
  apps,
  activeDeployments,
  builds,
  capabilitySets,
  catalogObjects,
  dataConnections,
  deployments,
  idempotencyRecords,
  organizationBranding,
  organizationMemberships,
  schemaVersions,
  sourceVersions,
  usageEvents,
  users,
  runtimeAppUrl,
  type ToolflowDatabase,
} from "@toolflow/database";
import {
  forbiddenSourceConstructs,
  initialSourceFiles,
  isEditableSourcePath,
  manifestPath,
} from "@toolflow/app-template";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import { and, desc, eq, ilike, inArray, max, or, sql } from "drizzle-orm";
import type { Principal } from "@toolflow/auth";
import { canManageApp, roleCan } from "@toolflow/policy";

export class McpServiceError extends Error {
  constructor(
    readonly code: "AUTHORIZATION_DENIED" | "CONFLICT" | "VALIDATION_FAILED" | "NOT_FOUND",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface CreateAppRequest {
  slug: string;
  name: string;
  description: string;
  ownerMembershipId: string;
  idempotencyKey: string;
}

export interface UpdateFilesRequest {
  appId: string;
  baseVersionId: string;
  files: SourceFile[];
  deletedPaths: string[];
  message: string;
  idempotencyKey: string;
}

export interface SetAppStateRequest {
  appId: string;
  disabled: boolean;
  reason: string;
  confirmationName: string;
  idempotencyKey: string;
}

export interface SearchAppFilters {
  ownerMembershipId?: string;
  lifecycle?: "draft" | "preview" | "production" | "disabled" | "orphaned" | "archived";
  dataObject?: string;
}

export class ToolflowSourceService {
  constructor(
    private readonly database: ToolflowDatabase["db"],
    private readonly objects: ImmutableObjectStore,
    private readonly runtimeBaseUrl = "https://apps.toolflow.internal",
  ) {}

  async currentUser(principal: Principal) {
    const rows = await this.database
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    const user = rows[0];
    if (!user) throw new McpServiceError("NOT_FOUND", "Current user not found.");
    return { ...principal, name: user.name, email: user.email };
  }

  async listUsers(principal: Principal, offset: number, limit: number) {
    this.requireOrganizationRead(principal);
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
      .where(eq(organizationMemberships.organizationId, principal.organizationId))
      .orderBy(users.name)
      .limit(limit)
      .offset(offset);
  }

  async branding(principal: Principal) {
    this.requireOrganizationRead(principal);
    const rows = await this.database
      .select()
      .from(organizationBranding)
      .where(eq(organizationBranding.organizationId, principal.organizationId))
      .limit(1);
    const branding = rows[0];
    if (!branding) throw new McpServiceError("NOT_FOUND", "Organization branding not found.");
    return {
      displayName: branding.displayName,
      logoObjectKey: branding.logoObjectKey,
      tokens: {
        primary: branding.primaryColor,
        onPrimary: accessibleForeground(branding.primaryColor),
        background: "#F7F8F5",
        foreground: "#17231F",
      },
      guidance: branding.designGuidance,
      version: branding.updatedAt.toISOString(),
    };
  }

  async searchApps(
    principal: Principal,
    query: string,
    offset: number,
    limit: number,
    filters: SearchAppFilters = {},
  ) {
    this.requireOrganizationRead(principal);
    const pattern = `%${query}%`;
    const dataPattern = `%${filters.dataObject ?? ""}%`;
    const rows = await this.database
      .select()
      .from(apps)
      .where(
        and(
          eq(apps.organizationId, principal.organizationId),
          filters.lifecycle ? eq(apps.lifecycle, filters.lifecycle) : undefined,
          filters.ownerMembershipId
            ? sql`exists (select 1 from ${appOwners} where ${appOwners.appId} = ${apps.id} and ${appOwners.membershipId} = ${filters.ownerMembershipId})`
            : undefined,
          filters.dataObject
            ? sql`exists (
                select 1 from ${sourceVersions} latest_source
                inner join ${capabilitySets} latest_capabilities
                  on latest_capabilities.source_version_id = latest_source.id
                where latest_source.app_id = ${apps.id}
                  and latest_source.id = (
                    select candidate.id from ${sourceVersions} candidate
                    where candidate.app_id = ${apps.id}
                    order by candidate.created_at desc limit 1
                  )
                  and latest_capabilities.capabilities::text ilike ${dataPattern}
              )`
            : undefined,
          query
            ? or(
                ilike(apps.name, pattern),
                ilike(apps.description, pattern),
                ilike(apps.slug, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(apps.name)
      .limit(limit)
      .offset(offset);
    return Promise.all(
      rows.map(async (app) => {
        const [owners, latestDeployment, production] = await Promise.all([
          this.database
            .select({ membershipId: appOwners.membershipId, name: users.name })
            .from(appOwners)
            .innerJoin(
              organizationMemberships,
              eq(organizationMemberships.id, appOwners.membershipId),
            )
            .innerJoin(users, eq(users.id, organizationMemberships.userId))
            .where(eq(appOwners.appId, app.id)),
          this.database
            .select({ completedAt: max(deployments.completedAt) })
            .from(deployments)
            .where(and(eq(deployments.appId, app.id), eq(deployments.status, "succeeded"))),
          this.database
            .select({
              deploymentId: activeDeployments.deploymentId,
              routeKey: appRoutes.routeKey,
            })
            .from(activeDeployments)
            .innerJoin(
              appRoutes,
              and(
                eq(appRoutes.appId, activeDeployments.appId),
                eq(appRoutes.environment, "production"),
              ),
            )
            .where(
              and(
                eq(activeDeployments.appId, app.id),
                eq(activeDeployments.environment, "production"),
              ),
            )
            .limit(1),
        ]);
        return {
          id: app.id,
          slug: app.slug,
          name: app.name,
          description: app.description,
          lifecycle: app.lifecycle,
          owners,
          productionUrl: production[0]
            ? runtimeAppUrl(this.runtimeBaseUrl, production[0].routeKey, {
                organizationId: principal.organizationId,
                appSlug: app.slug,
                environment: "production",
              })
            : null,
          lastDeploymentAt: latestDeployment[0]?.completedAt?.toISOString() ?? null,
          updatedAt: app.updatedAt.toISOString(),
        };
      }),
    );
  }

  async setAppState(principal: Principal, input: SetAppStateRequest) {
    if (!roleCan(principal.role, "apps:disable")) {
      throw new McpServiceError(
        "AUTHORIZATION_DENIED",
        "Emergency app controls are restricted to admins.",
      );
    }
    const replay = await this.readIdempotency(
      principal,
      "disable_app",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    const rows = await this.database
      .select()
      .from(apps)
      .where(and(eq(apps.organizationId, principal.organizationId), eq(apps.id, input.appId)))
      .limit(1);
    const app = rows[0];
    if (!app) throw new McpServiceError("NOT_FOUND", "App not found.");
    if (app.name !== input.confirmationName) {
      throw new McpServiceError("VALIDATION_FAILED", "Confirmation name does not match.");
    }
    let lifecycle = app.lifecycle;
    if (input.disabled) {
      lifecycle = "disabled";
    } else if (app.lifecycle === "disabled") {
      const active = await this.database
        .select({ environment: activeDeployments.environment })
        .from(activeDeployments)
        .where(eq(activeDeployments.appId, app.id));
      lifecycle = active.some((deployment) => deployment.environment === "production")
        ? "production"
        : active.some((deployment) => deployment.environment === "preview")
          ? "preview"
          : "draft";
    }
    const [updated] = await this.database
      .update(apps)
      .set({
        lifecycle,
        disabledReason: input.disabled ? input.reason : null,
        updatedAt: new Date(),
      })
      .where(and(eq(apps.organizationId, principal.organizationId), eq(apps.id, input.appId)))
      .returning();
    if (!updated) throw new Error("App state update did not return a record.");
    const result = {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      lifecycle: updated.lifecycle,
      disabledReason: updated.disabledReason,
      updatedAt: updated.updatedAt.toISOString(),
    };
    await this.writeIdempotency(principal, "disable_app", input.idempotencyKey, input, result);
    return result;
  }

  async listConnections(principal: Principal, offset: number, limit: number) {
    this.requireOrganizationRead(principal);
    const rows = await this.database
      .select({
        id: dataConnections.id,
        slug: dataConnections.slug,
        name: dataConnections.name,
        kind: dataConnections.kind,
        status: dataConnections.status,
        configuration: dataConnections.configuration,
        updatedAt: dataConnections.updatedAt,
      })
      .from(dataConnections)
      .where(
        and(
          eq(dataConnections.organizationId, principal.organizationId),
          inArray(dataConnections.status, ["active", "disabled"]),
        ),
      )
      .orderBy(dataConnections.name)
      .limit(limit)
      .offset(offset);
    return rows.map((row) => {
      const config = row.configuration as { approvedTables?: unknown[] };
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        status: row.status,
        approvedTableCount: config.approvedTables?.length ?? 0,
        version: row.updatedAt.toISOString(),
      };
    });
  }

  async searchCatalog(principal: Principal, query: string, offset: number, limit: number) {
    this.requireOrganizationRead(principal);
    const pattern = `%${query}%`;
    return this.database
      .select({
        id: catalogObjects.id,
        connectionId: catalogObjects.connectionId,
        kind: catalogObjects.kind,
        schema: catalogObjects.schemaName,
        object: catalogObjects.objectName,
        dataType: catalogObjects.dataType,
        nullable: catalogObjects.nullable,
        description: catalogObjects.description,
        lifecycle: catalogObjects.lifecycle,
        sensitivity: catalogObjects.sensitivity,
        sourceOfTruth: catalogObjects.sourceOfTruth,
        metadata: catalogObjects.metadata,
        version: catalogObjects.catalogVersion,
      })
      .from(catalogObjects)
      .innerJoin(dataConnections, eq(dataConnections.id, catalogObjects.connectionId))
      .where(
        and(
          eq(catalogObjects.organizationId, principal.organizationId),
          inArray(catalogObjects.lifecycle, ["active", "deprecated"]),
          sql`${catalogObjects.sensitivity} <> 'restricted'`,
          eq(dataConnections.status, "active"),
          query
            ? or(
                ilike(catalogObjects.schemaName, pattern),
                ilike(catalogObjects.objectName, pattern),
                ilike(catalogObjects.description, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(catalogObjects.schemaName, catalogObjects.objectName)
      .limit(limit)
      .offset(offset);
  }

  async createApp(principal: Principal, input: CreateAppRequest) {
    if (!roleCan(principal.role, "apps:create")) {
      throw new McpServiceError("AUTHORIZATION_DENIED", "App creation is denied.");
    }
    const replay = await this.readIdempotency(principal, "create_app", input.idempotencyKey, input);
    if (replay) return replay;
    const ownerRows = await this.database
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.id, input.ownerMembershipId),
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!ownerRows[0])
      throw new McpServiceError("VALIDATION_FAILED", "Owner must be active in this organization.");
    const appId = crypto.randomUUID();
    const files = initialSourceFiles.map((file) =>
      file.path === manifestPath
        ? { ...file, content: file.content.replace("New Toolflow app", input.name) }
        : { ...file, content: file.content.replace("New internal tool", input.name) },
    );
    const prepared = this.prepareBundle(files);
    const sourceVersionId = crypto.randomUUID();
    const objectKey = `sources/${principal.organizationId}/${appId}/${prepared.contentHash}.json`;
    await this.objects.put(objectKey, prepared.bytes);
    const result = await this.database.transaction(async (transaction) => {
      await transaction.insert(apps).values({
        id: appId,
        organizationId: principal.organizationId,
        slug: input.slug,
        name: input.name,
        description: input.description,
      });
      const initialMembershipIds = [...new Set([input.ownerMembershipId, principal.membershipId])];
      await transaction
        .insert(appOwners)
        .values(initialMembershipIds.map((membershipId) => ({ appId, membershipId })));
      await transaction
        .insert(appMembers)
        .values(initialMembershipIds.map((membershipId) => ({ appId, membershipId })));
      await transaction.insert(appDataSpaces).values([
        {
          organizationId: principal.organizationId,
          appId,
          environment: "preview",
          schemaName: dataSchemaName(principal.organizationId, appId, "preview"),
        },
        {
          organizationId: principal.organizationId,
          appId,
          environment: "production",
          schemaName: dataSchemaName(principal.organizationId, appId, "production"),
        },
      ]);
      await transaction.insert(appRoutes).values([
        {
          organizationId: principal.organizationId,
          appId,
          environment: "preview",
        },
        {
          organizationId: principal.organizationId,
          appId,
          environment: "production",
        },
      ]);
      await transaction.insert(sourceVersions).values({
        id: sourceVersionId,
        organizationId: principal.organizationId,
        appId,
        actorMembershipId: principal.membershipId,
        message: "Initial Toolflow template",
        contentHash: prepared.contentHash,
        manifestHash: prepared.manifestHash,
        objectKey,
        fileCount: files.length,
        sourceBytes: prepared.sourceBytes,
      });
      await transaction.insert(capabilitySets).values({
        organizationId: principal.organizationId,
        appId,
        sourceVersionId,
        hash: prepared.capabilityHash,
        capabilities: prepared.manifest.capabilities,
      });
      await transaction.insert(schemaVersions).values({
        organizationId: principal.organizationId,
        appId,
        sourceVersionId,
        hash: prepared.schemaHash,
        schema: prepared.manifest.schema,
      });
      return {
        appId,
        sourceVersionId,
        contentHash: prepared.contentHash,
        files: files.map((file) => file.path),
        lifecycle: "draft" as const,
      };
    });
    await this.writeIdempotency(principal, "create_app", input.idempotencyKey, input, result);
    return result;
  }

  async getApp(principal: Principal, appId: string, includeSource: boolean) {
    const app = await this.requireManageableApp(principal, appId, true);
    const latest = await this.latestVersion(appId);
    if (!latest) throw new McpServiceError("NOT_FOUND", "App has no source version.");
    const bundle = includeSource ? await this.readBundle(latest.objectKey) : null;
    return {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      lifecycle: app.lifecycle,
      currentSourceVersion: this.sourceVersionView(latest),
      ...(bundle
        ? {
            files: bundle.files.map((file) => ({
              path: file.path,
              bytes: Buffer.byteLength(file.content, "utf8"),
            })),
          }
        : {}),
    };
  }

  async readAppFile(principal: Principal, appId: string, path: string, versionId?: string) {
    await this.requireManageableApp(principal, appId, true);
    const version = versionId
      ? await this.versionById(appId, versionId)
      : await this.latestVersion(appId);
    if (!version) throw new McpServiceError("NOT_FOUND", "Source version not found.");
    const bundle = await this.readBundle(version.objectKey);
    const file = bundle.files.find((candidate) => candidate.path === path);
    if (!file) throw new McpServiceError("NOT_FOUND", "Source file not found.");
    return { versionId: version.id, ...file };
  }

  async listAppMembers(principal: Principal, appId: string, offset: number, limit: number) {
    await this.requireManageableApp(principal, appId, true);
    return this.database
      .select({
        membershipId: organizationMemberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        owner: sql<boolean>`exists (
          select 1 from ${appOwners}
          where ${appOwners.appId} = ${appId}
            and ${appOwners.membershipId} = ${organizationMemberships.id}
        )`,
      })
      .from(appMembers)
      .innerJoin(organizationMemberships, eq(organizationMemberships.id, appMembers.membershipId))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(appMembers.appId, appId),
          eq(organizationMemberships.organizationId, principal.organizationId),
        ),
      )
      .orderBy(users.name, users.email)
      .limit(limit)
      .offset(offset);
  }

  async appActivity(
    principal: Principal,
    appId: string,
    window: "24h" | "7d" | "30d",
    environment?: "preview" | "production",
  ) {
    await this.requireManageableApp(principal, appId, true);
    const hours = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24 }[window];
    const since = new Date(Date.now() - hours * 60 * 60 * 1_000);
    const conditions = [
      eq(usageEvents.organizationId, principal.organizationId),
      eq(usageEvents.appId, appId),
      sql`${usageEvents.occurredAt} >= ${since}`,
    ];
    if (environment) conditions.push(eq(usageEvents.environment, environment));
    const deploymentConditions = [
      eq(deployments.organizationId, principal.organizationId),
      eq(deployments.appId, appId),
      sql`${deployments.createdAt} >= ${since}`,
    ];
    if (environment) deploymentConditions.push(eq(deployments.environment, environment));
    const [rows, buildRows, deploymentRows] = await Promise.all([
      this.database
        .select({
          requestCount: sql<number>`count(*)`,
          uniqueActiveMembers: sql<number>`count(distinct ${usageEvents.actorHash})`,
          errorCount: sql<number>`count(*) filter (where ${usageEvents.outcome} <> 'succeeded')`,
          averageLatencyMs: sql<number>`coalesce(avg(${usageEvents.durationMs}), 0)`,
          externalQueryCount: sql<number>`count(*) filter (where ${usageEvents.eventType} = 'data.external.read')`,
          managedWriteCount: sql<number>`count(*) filter (where ${usageEvents.eventType} in ('data.managed.create', 'data.managed.update', 'data.managed.delete'))`,
          lastActivityAt: max(usageEvents.occurredAt),
        })
        .from(usageEvents)
        .where(and(...conditions)),
      this.database
        .select({ status: builds.status, count: sql<number>`count(*)` })
        .from(builds)
        .where(
          and(
            eq(builds.organizationId, principal.organizationId),
            eq(builds.appId, appId),
            sql`${builds.createdAt} >= ${since}`,
          ),
        )
        .groupBy(builds.status),
      this.database
        .select({ status: deployments.status, count: sql<number>`count(*)` })
        .from(deployments)
        .where(and(...deploymentConditions))
        .groupBy(deployments.status),
    ]);
    const result = rows[0];
    const requestCount = Number(result?.requestCount ?? 0);
    return {
      appId,
      environment: environment ?? null,
      window,
      requestCount,
      uniqueActiveMembers: Number(result?.uniqueActiveMembers ?? 0),
      errorRate: requestCount === 0 ? 0 : Number(result?.errorCount ?? 0) / requestCount,
      averageLatencyMs: Number(result?.averageLatencyMs ?? 0),
      externalQueryCount: Number(result?.externalQueryCount ?? 0),
      managedWriteCount: Number(result?.managedWriteCount ?? 0),
      buildOutcomes: countBuildOutcomes(buildRows),
      deploymentOutcomes: countDeploymentOutcomes(deploymentRows),
      lastActivityAt: result?.lastActivityAt?.toISOString() ?? null,
    };
  }

  async grantAppAccess(
    principal: Principal,
    input: { appId: string; membershipId: string; idempotencyKey: string },
  ) {
    const replay = await this.readIdempotency(
      principal,
      "grant_app_access",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    await this.requireManageableApp(principal, input.appId, true);
    const memberships = await this.database
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.id, input.membershipId),
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!memberships[0]) {
      throw new McpServiceError(
        "VALIDATION_FAILED",
        "App access can be granted only to an active organization member.",
      );
    }
    await this.database
      .insert(appMembers)
      .values({ appId: input.appId, membershipId: input.membershipId })
      .onConflictDoNothing();
    const result = { appId: input.appId, membershipId: input.membershipId, granted: true };
    await this.writeIdempotency(principal, "grant_app_access", input.idempotencyKey, input, result);
    return result;
  }

  async revokeAppAccess(
    principal: Principal,
    input: { appId: string; membershipId: string; idempotencyKey: string },
  ) {
    const replay = await this.readIdempotency(
      principal,
      "revoke_app_access",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    await this.requireManageableApp(principal, input.appId, true);
    const owners = await this.database
      .select({ membershipId: appOwners.membershipId })
      .from(appOwners)
      .where(and(eq(appOwners.appId, input.appId), eq(appOwners.membershipId, input.membershipId)))
      .limit(1);
    if (owners[0]) {
      throw new McpServiceError(
        "CONFLICT",
        "Transfer or remove app ownership before revoking an owner's access.",
      );
    }
    const removed = await this.database
      .delete(appMembers)
      .where(
        and(eq(appMembers.appId, input.appId), eq(appMembers.membershipId, input.membershipId)),
      )
      .returning({ membershipId: appMembers.membershipId });
    const result = {
      appId: input.appId,
      membershipId: input.membershipId,
      revoked: removed.length > 0,
    };
    await this.writeIdempotency(
      principal,
      "revoke_app_access",
      input.idempotencyKey,
      input,
      result,
    );
    return result;
  }

  async updateFiles(principal: Principal, input: UpdateFilesRequest) {
    const replay = await this.readIdempotency(
      principal,
      "update_app_files",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    if (input.files.length + input.deletedPaths.length > 100) {
      throw new McpServiceError("VALIDATION_FAILED", "A mutation may change at most 100 files.");
    }
    const mutationBytes = input.files.reduce(
      (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
      0,
    );
    if (mutationBytes > 2_000_000)
      throw new McpServiceError("VALIDATION_FAILED", "Mutation exceeds 2 MB.");
    await this.requireManageableApp(principal, input.appId, true);
    for (const path of [...input.files.map((file) => file.path), ...input.deletedPaths]) {
      if (!isEditableSourcePath(path))
        throw new McpServiceError("VALIDATION_FAILED", `Path is not editable: ${path}`);
    }
    const result = await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${apps} where id = ${input.appId} and organization_id = ${principal.organizationId} for update`,
      );
      const latestRows = await transaction
        .select()
        .from(sourceVersions)
        .where(
          and(
            eq(sourceVersions.organizationId, principal.organizationId),
            eq(sourceVersions.appId, input.appId),
          ),
        )
        .orderBy(desc(sourceVersions.createdAt))
        .limit(1);
      const latest = latestRows[0];
      if (!latest) throw new McpServiceError("NOT_FOUND", "Current source version not found.");
      if (latest.id !== input.baseVersionId) {
        throw new McpServiceError("CONFLICT", "Base source version is stale.", {
          latestVersionId: latest.id,
        });
      }
      const current = await this.readBundle(latest.objectKey);
      const next = new Map(current.files.map((file) => [file.path, file.content]));
      for (const path of input.deletedPaths) next.delete(path);
      for (const file of input.files) next.set(file.path, file.content);
      const prepared = this.prepareBundle([...next].map(([path, content]) => ({ path, content })));
      if (prepared.contentHash === latest.contentHash)
        throw new McpServiceError("CONFLICT", "Mutation does not change source content.");
      const versionId = crypto.randomUUID();
      const objectKey = `sources/${principal.organizationId}/${input.appId}/${prepared.contentHash}.json`;
      await this.objects.put(objectKey, prepared.bytes);
      await transaction.insert(sourceVersions).values({
        id: versionId,
        organizationId: principal.organizationId,
        appId: input.appId,
        parentVersionId: latest.id,
        actorMembershipId: principal.membershipId,
        message: input.message,
        contentHash: prepared.contentHash,
        manifestHash: prepared.manifestHash,
        objectKey,
        fileCount: prepared.bundle.files.length,
        sourceBytes: prepared.sourceBytes,
      });
      await transaction.insert(capabilitySets).values({
        organizationId: principal.organizationId,
        appId: input.appId,
        sourceVersionId: versionId,
        hash: prepared.capabilityHash,
        capabilities: prepared.manifest.capabilities,
      });
      await transaction.insert(schemaVersions).values({
        organizationId: principal.organizationId,
        appId: input.appId,
        sourceVersionId: versionId,
        hash: prepared.schemaHash,
        schema: prepared.manifest.schema,
      });
      return {
        appId: input.appId,
        sourceVersionId: versionId,
        parentVersionId: latest.id,
        contentHash: prepared.contentHash,
        manifestHash: prepared.manifestHash,
        files: prepared.bundle.files.map((file) => file.path),
      };
    });
    await this.writeIdempotency(principal, "update_app_files", input.idempotencyKey, input, result);
    return result;
  }

  private prepareBundle(files: SourceFile[]) {
    const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
    if (sorted.length > 200)
      throw new McpServiceError("VALIDATION_FAILED", "Source version exceeds 200 files.");
    const seen = new Set<string>();
    for (const file of sorted) {
      if (!isEditableSourcePath(file.path))
        throw new McpServiceError("VALIDATION_FAILED", `Path is not editable: ${file.path}`);
      if (seen.has(file.path))
        throw new McpServiceError("VALIDATION_FAILED", `Duplicate source path: ${file.path}`);
      seen.add(file.path);
      const forbidden = forbiddenSourceConstructs(file.content);
      if (forbidden.length)
        throw new McpServiceError(
          "VALIDATION_FAILED",
          `Forbidden constructs in ${file.path}: ${forbidden.join(", ")}`,
        );
    }
    const manifestFile = sorted.find((file) => file.path === manifestPath);
    if (!manifestFile)
      throw new McpServiceError("VALIDATION_FAILED", "toolflow.manifest.json is required.");
    let manifest: AppManifest;
    try {
      manifest = appManifestSchema.parse(JSON.parse(manifestFile.content));
    } catch (error) {
      throw new McpServiceError("VALIDATION_FAILED", "Manifest is invalid.", {
        error: error instanceof Error ? error.message : "Invalid JSON",
      });
    }
    const bundle: SourceBundle = { version: 1, files: sorted };
    const canonical = JSON.stringify(bundle);
    const bytes = new TextEncoder().encode(canonical);
    if (bytes.byteLength > 5_000_000)
      throw new McpServiceError("VALIDATION_FAILED", "Source version exceeds 5 MB.");
    return {
      bundle,
      bytes,
      sourceBytes: bytes.byteLength,
      manifest,
      contentHash: hash(canonical),
      manifestHash: hash(stableJson(manifest)),
      capabilityHash: hash(
        stableJson(
          [...manifest.capabilities].sort((left, right) =>
            capabilityKey(left).localeCompare(capabilityKey(right)),
          ),
        ),
      ),
      schemaHash: hash(stableJson(manifest.schema)),
    };
  }

  private async readBundle(objectKey: string): Promise<SourceBundle> {
    return JSON.parse(new TextDecoder().decode(await this.objects.get(objectKey))) as SourceBundle;
  }

  private async latestVersion(appId: string) {
    const rows = await this.database
      .select()
      .from(sourceVersions)
      .where(eq(sourceVersions.appId, appId))
      .orderBy(desc(sourceVersions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  private async versionById(appId: string, versionId: string) {
    const rows = await this.database
      .select()
      .from(sourceVersions)
      .where(and(eq(sourceVersions.appId, appId), eq(sourceVersions.id, versionId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private sourceVersionView(version: typeof sourceVersions.$inferSelect) {
    return {
      id: version.id,
      parentVersionId: version.parentVersionId,
      contentHash: version.contentHash,
      manifestHash: version.manifestHash,
      message: version.message,
      fileCount: version.fileCount,
      sourceBytes: version.sourceBytes,
      createdAt: version.createdAt.toISOString(),
    };
  }

  private async requireManageableApp(principal: Principal, appId: string, requireEdit: boolean) {
    const rows = await this.database
      .select()
      .from(apps)
      .where(and(eq(apps.organizationId, principal.organizationId), eq(apps.id, appId)))
      .limit(1);
    const app = rows[0];
    if (!app) throw new McpServiceError("NOT_FOUND", "App not found.");
    if (requireEdit) {
      const owners = await this.database
        .select({ membershipId: appOwners.membershipId })
        .from(appOwners)
        .where(eq(appOwners.appId, appId));
      if (
        !canManageApp(
          principal.role,
          principal.membershipId,
          owners.map((owner) => owner.membershipId),
        )
      )
        throw new McpServiceError("AUTHORIZATION_DENIED", "App source access is denied.");
    }
    return app;
  }

  private requireOrganizationRead(principal: Principal) {
    if (!roleCan(principal.role, "organization:read"))
      throw new McpServiceError("AUTHORIZATION_DENIED", "Organization context access is denied.");
  }

  private async readIdempotency(
    principal: Principal,
    operation: string,
    key: string,
    request: unknown,
  ) {
    const rows = await this.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, principal.organizationId),
          eq(idempotencyRecords.actorId, principal.userId),
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.key, key),
        ),
      )
      .limit(1);
    const record = rows[0];
    if (!record) return null;
    if (record.requestHash !== hash(stableJson(request)))
      throw new McpServiceError(
        "CONFLICT",
        "Idempotency key was already used with a different request.",
      );
    return record.response;
  }

  private async writeIdempotency(
    principal: Principal,
    operation: string,
    key: string,
    request: unknown,
    response: unknown,
  ) {
    await this.database
      .insert(idempotencyRecords)
      .values({
        organizationId: principal.organizationId,
        actorId: principal.userId,
        operation,
        key,
        requestHash: hash(stableJson(request)),
        statusCode: 200,
        response,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .onConflictDoNothing();
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function countBuildOutcomes(rows: { status: string; count: number }[]) {
  const result = { queued: 0, running: 0, succeeded: 0, failed: 0, timedOut: 0 };
  for (const row of rows) {
    if (row.status === "timed_out") result.timedOut = Number(row.count);
    else if (row.status in result) result[row.status as keyof typeof result] = Number(row.count);
  }
  return result;
}
function countDeploymentOutcomes(rows: { status: string; count: number }[]) {
  const result = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in result) result[row.status as keyof typeof result] = Number(row.count);
  }
  return result;
}
function dataSchemaName(organizationId: string, appId: string, environment: string) {
  return `tf_${organizationId.replaceAll("-", "").slice(0, 8)}_${appId.replaceAll("-", "").slice(0, 8)}_${environment}`;
}
