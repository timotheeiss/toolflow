import { createHash } from "node:crypto";
import type {
  AdminAppSummary,
  AdminAppDetail,
  AppActivity,
  AppStateInput,
  AuditEventView,
  CatalogObject,
  CatalogRefreshInput,
  CatalogRefreshResult,
  ConnectionStateInput,
  ConnectionTestResult,
  DataConnection,
  OverviewMetrics,
  PostgresConnectionInput,
  UpdateCatalogObjectInput,
  UpdatePostgresConnectionInput,
  AppCapability,
} from "@toolflow/contracts";
import {
  activeDeployments,
  appMembers,
  appOwners,
  apps,
  auditEvents,
  builds,
  capabilitySets,
  catalogObjects,
  dataConnections,
  deployments,
  organizationMemberships,
  schemaVersions,
  sourceVersions,
  usageEvents,
  users,
  type ToolflowDatabase,
} from "@toolflow/database";
import type { SecretVault } from "@toolflow/secrets";
import { and, count, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";
import {
  connectionFromInput,
  type ConnectionInspector,
  type DiscoveredCatalogObject,
} from "./connection-inspector.js";
import { ControlApiError } from "./errors.js";

type Database = ToolflowDatabase["db"];

interface StoredConnectionConfiguration {
  host: string;
  port: number;
  database: string;
  username: string;
  tlsMode: "verify-full" | "require" | "disable";
  approvedTables: { schema: string; table: string }[];
  lastTestResult: ConnectionTestResult | null;
}

export interface AuditFilters {
  action?: string;
  outcome?: "succeeded" | "failed" | "denied";
  actor?: string;
  actorId?: string;
  actorType?: string;
  target?: string;
  targetType?: string;
  environment?: "preview" | "production";
  appId?: string;
  requestId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface GovernanceStore {
  getOverview(organizationId: string): Promise<OverviewMetrics>;
  getAppActivity(
    organizationId: string,
    appId: string,
    window: "24h" | "7d" | "30d",
    environment?: "preview" | "production",
  ): Promise<AppActivity>;
  listApps(organizationId: string, actorMembershipId?: string): Promise<AdminAppSummary[]>;
  getAppDetail(organizationId: string, appId: string): Promise<AdminAppDetail>;
  setAppState(
    organizationId: string,
    appId: string,
    input: AppStateInput,
  ): Promise<AdminAppSummary>;
  listConnections(organizationId: string): Promise<DataConnection[]>;
  createConnection(organizationId: string, input: PostgresConnectionInput): Promise<DataConnection>;
  updateConnection(
    organizationId: string,
    connectionId: string,
    input: UpdatePostgresConnectionInput,
  ): Promise<DataConnection>;
  testConnection(organizationId: string, connectionId: string): Promise<ConnectionTestResult>;
  setConnectionState(
    organizationId: string,
    connectionId: string,
    input: ConnectionStateInput,
  ): Promise<DataConnection>;
  removeConnection(organizationId: string, connectionId: string): Promise<void>;
  listCatalog(organizationId: string, includeHidden: boolean): Promise<CatalogObject[]>;
  refreshCatalog(
    organizationId: string,
    connectionId: string,
    input: CatalogRefreshInput,
  ): Promise<CatalogRefreshResult>;
  updateCatalogObject(
    organizationId: string,
    objectId: string,
    input: UpdateCatalogObjectInput,
  ): Promise<CatalogObject>;
  listAudit(organizationId: string, filters: AuditFilters): Promise<AuditEventView[]>;
}

export class DatabaseGovernanceStore implements GovernanceStore {
  constructor(
    private readonly database: Database,
    private readonly vault: SecretVault,
    private readonly inspector: ConnectionInspector,
    private readonly allowInsecureTls = false,
  ) {}

  async getOverview(organizationId: string): Promise<OverviewMetrics> {
    const [production, connections, attention] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(apps)
        .where(and(eq(apps.organizationId, organizationId), eq(apps.lifecycle, "production"))),
      this.database
        .select({ value: count() })
        .from(dataConnections)
        .where(
          and(
            eq(dataConnections.organizationId, organizationId),
            eq(dataConnections.status, "active"),
          ),
        ),
      this.database
        .select({ value: count() })
        .from(apps)
        .where(
          and(
            eq(apps.organizationId, organizationId),
            inArray(apps.lifecycle, ["disabled", "orphaned"]),
          ),
        ),
    ]);
    return {
      productionApps: Number(production[0]?.value ?? 0),
      activeConnections: Number(connections[0]?.value ?? 0),
      appsRequiringAttention: Number(attention[0]?.value ?? 0),
    };
  }

  async getAppActivity(
    organizationId: string,
    appId: string,
    window: "24h" | "7d" | "30d",
    environment?: "preview" | "production",
  ): Promise<AppActivity> {
    await this.requireApp(organizationId, appId);
    const windowMs = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24 }[window] * 60 * 60 * 1_000;
    const since = new Date(Date.now() - windowMs);
    const conditions = [
      eq(usageEvents.organizationId, organizationId),
      eq(usageEvents.appId, appId),
      sql`${usageEvents.occurredAt} >= ${since}`,
    ];
    if (environment) conditions.push(eq(usageEvents.environment, environment));
    const deploymentConditions = [
      eq(deployments.organizationId, organizationId),
      eq(deployments.appId, appId),
      gte(deployments.createdAt, since),
    ];
    if (environment) deploymentConditions.push(eq(deployments.environment, environment));
    const [aggregate, errors, buildRows, deploymentRows] = await Promise.all([
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
        .select({
          requestId: usageEvents.requestId,
          deploymentId: usageEvents.deploymentId,
          eventType: usageEvents.eventType,
          environment: usageEvents.environment,
          occurredAt: usageEvents.occurredAt,
        })
        .from(usageEvents)
        .where(and(...conditions, sql`${usageEvents.outcome} <> 'succeeded'`))
        .orderBy(desc(usageEvents.occurredAt))
        .limit(10),
      this.database
        .select({ status: builds.status, count: sql<number>`count(*)` })
        .from(builds)
        .where(
          and(
            eq(builds.organizationId, organizationId),
            eq(builds.appId, appId),
            gte(builds.createdAt, since),
          ),
        )
        .groupBy(builds.status),
      this.database
        .select({ status: deployments.status, count: sql<number>`count(*)` })
        .from(deployments)
        .where(and(...deploymentConditions))
        .groupBy(deployments.status),
    ]);
    const metrics = aggregate[0];
    const requestCount = Number(metrics?.requestCount ?? 0);
    return {
      appId,
      environment: environment ?? null,
      window,
      requestCount,
      uniqueActiveMembers: Number(metrics?.uniqueActiveMembers ?? 0),
      errorRate: requestCount === 0 ? 0 : Number(metrics?.errorCount ?? 0) / requestCount,
      averageLatencyMs: Number(metrics?.averageLatencyMs ?? 0),
      externalQueryCount: Number(metrics?.externalQueryCount ?? 0),
      managedWriteCount: Number(metrics?.managedWriteCount ?? 0),
      buildOutcomes: countBuildOutcomes(buildRows),
      deploymentOutcomes: countDeploymentOutcomes(deploymentRows),
      lastActivityAt: metrics?.lastActivityAt?.toISOString() ?? null,
      recentErrors: errors.map((error) => ({
        requestId: error.requestId,
        deploymentId: error.deploymentId,
        eventType: error.eventType,
        environment: error.environment,
        occurredAt: error.occurredAt.toISOString(),
      })),
    };
  }

  async listApps(organizationId: string, actorMembershipId?: string): Promise<AdminAppSummary[]> {
    const appRows = await this.database
      .select()
      .from(apps)
      .where(
        actorMembershipId
          ? and(
              eq(apps.organizationId, organizationId),
              sql`exists (select 1 from ${appOwners} where ${appOwners.appId} = ${apps.id} and ${appOwners.membershipId} = ${actorMembershipId})`,
            )
          : eq(apps.organizationId, organizationId),
      )
      .orderBy(apps.name);
    return Promise.all(appRows.map((app) => this.appSummary(app)));
  }

  async getAppDetail(organizationId: string, appId: string): Promise<AdminAppDetail> {
    const app = await this.requireApp(organizationId, appId);
    const [
      memberRows,
      ownerRows,
      versionRows,
      buildRows,
      deploymentRows,
      activeRows,
      capabilityRows,
      schemaRows,
    ] = await Promise.all([
      this.database
        .select({
          membershipId: organizationMemberships.id,
          name: users.name,
          email: users.email,
          role: organizationMemberships.role,
          status: organizationMemberships.status,
        })
        .from(appMembers)
        .innerJoin(organizationMemberships, eq(organizationMemberships.id, appMembers.membershipId))
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(appMembers.appId, appId),
            eq(organizationMemberships.organizationId, organizationId),
          ),
        ),
      this.database
        .select({
          membershipId: organizationMemberships.id,
          name: users.name,
          email: users.email,
          role: organizationMemberships.role,
          status: organizationMemberships.status,
        })
        .from(appOwners)
        .innerJoin(organizationMemberships, eq(organizationMemberships.id, appOwners.membershipId))
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(appOwners.appId, appId),
            eq(organizationMemberships.organizationId, organizationId),
          ),
        ),
      this.database
        .select()
        .from(sourceVersions)
        .where(
          and(eq(sourceVersions.organizationId, organizationId), eq(sourceVersions.appId, appId)),
        )
        .orderBy(desc(sourceVersions.createdAt))
        .limit(100),
      this.database
        .select()
        .from(builds)
        .where(and(eq(builds.organizationId, organizationId), eq(builds.appId, appId)))
        .orderBy(desc(builds.createdAt))
        .limit(100),
      this.database
        .select()
        .from(deployments)
        .where(and(eq(deployments.organizationId, organizationId), eq(deployments.appId, appId)))
        .orderBy(desc(deployments.createdAt))
        .limit(100),
      this.database.select().from(activeDeployments).where(eq(activeDeployments.appId, appId)),
      this.database
        .select()
        .from(capabilitySets)
        .where(
          and(eq(capabilitySets.organizationId, organizationId), eq(capabilitySets.appId, appId)),
        )
        .orderBy(desc(capabilitySets.createdAt))
        .limit(1),
      this.database
        .select()
        .from(schemaVersions)
        .where(
          and(eq(schemaVersions.organizationId, organizationId), eq(schemaVersions.appId, appId)),
        )
        .orderBy(desc(schemaVersions.createdAt))
        .limit(1),
    ]);

    const owners = new Map(ownerRows.map((row) => [row.membershipId, row]));
    const members = new Map(memberRows.map((row) => [row.membershipId, row]));
    const people = new Map([...members, ...owners]);
    const activeDeploymentIds = new Set(activeRows.map((row) => row.deploymentId));
    const capability = capabilityRows[0];
    const schema = schemaRows[0];

    return {
      summary: await this.appSummary(app),
      members: [...people.values()]
        .map((person) => ({
          ...person,
          owner: owners.has(person.membershipId),
          appAccess: members.has(person.membershipId),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      sourceVersions: versionRows.map((version) => ({
        id: version.id,
        parentVersionId: version.parentVersionId,
        actorMembershipId: version.actorMembershipId,
        message: version.message,
        contentHash: version.contentHash,
        manifestHash: version.manifestHash,
        fileCount: version.fileCount,
        sourceBytes: version.sourceBytes,
        createdAt: version.createdAt.toISOString(),
      })),
      builds: buildRows.map((build) => ({
        id: build.id,
        sourceVersionId: build.sourceVersionId,
        runtimeVersionId: build.runtimeVersionId,
        status: build.status,
        artifactHash: build.artifactHash,
        diagnostics: Array.isArray(build.diagnostics) ? build.diagnostics : [],
        startedAt: build.startedAt?.toISOString() ?? null,
        completedAt: build.completedAt?.toISOString() ?? null,
        createdAt: build.createdAt.toISOString(),
      })),
      deployments: deploymentRows.map((deployment) => ({
        id: deployment.id,
        environment: deployment.environment,
        actorMembershipId: deployment.actorMembershipId,
        sourceVersionId: deployment.sourceVersionId,
        buildId: deployment.buildId,
        capabilitySetId: deployment.capabilitySetId,
        schemaVersionId: deployment.schemaVersionId,
        runtimeVersionId: deployment.runtimeVersionId,
        artifactHash: deployment.artifactHash,
        providerDeploymentId: deployment.providerDeploymentId,
        status: deployment.status,
        active: activeDeploymentIds.has(deployment.id),
        failure: deployment.failure ?? null,
        startedAt: deployment.startedAt?.toISOString() ?? null,
        completedAt: deployment.completedAt?.toISOString() ?? null,
        createdAt: deployment.createdAt.toISOString(),
      })),
      declaredCapabilities: capability
        ? {
            id: capability.id,
            sourceVersionId: capability.sourceVersionId,
            hash: capability.hash,
            capabilities: capability.capabilities as AppCapability[],
            createdAt: capability.createdAt.toISOString(),
          }
        : null,
      declaredSchema: schema
        ? {
            id: schema.id,
            sourceVersionId: schema.sourceVersionId,
            hash: schema.hash,
            schema: schema.schema as Record<string, unknown>,
            createdAt: schema.createdAt.toISOString(),
          }
        : null,
    };
  }

  async setAppState(
    organizationId: string,
    appId: string,
    input: AppStateInput,
  ): Promise<AdminAppSummary> {
    const current = await this.requireApp(organizationId, appId);
    if (input.confirmationName !== current.name) {
      throw new ControlApiError(422, "VALIDATION_FAILED", "Confirmation name does not match.");
    }
    const nextLifecycle = input.disabled
      ? "disabled"
      : current.lifecycle === "disabled"
        ? await this.restoredAppLifecycle(current.id)
        : current.lifecycle;
    const [updated] = await this.database
      .update(apps)
      .set({
        lifecycle: nextLifecycle,
        disabledReason: input.disabled ? input.reason : null,
        updatedAt: new Date(),
      })
      .where(and(eq(apps.organizationId, organizationId), eq(apps.id, appId)))
      .returning();
    if (!updated) throw new Error("App state update did not return a record.");
    return this.appSummary(updated);
  }

  private async restoredAppLifecycle(appId: string): Promise<"draft" | "preview" | "production"> {
    const active = await this.database
      .select({ environment: activeDeployments.environment })
      .from(activeDeployments)
      .where(eq(activeDeployments.appId, appId));
    if (active.some((deployment) => deployment.environment === "production")) return "production";
    if (active.some((deployment) => deployment.environment === "preview")) return "preview";
    return "draft";
  }

  async listConnections(organizationId: string): Promise<DataConnection[]> {
    const rows = await this.database
      .select()
      .from(dataConnections)
      .where(eq(dataConnections.organizationId, organizationId))
      .orderBy(dataConnections.name);
    return rows.map((row) => this.connectionView(row));
  }

  async createConnection(
    organizationId: string,
    input: PostgresConnectionInput,
  ): Promise<DataConnection> {
    this.assertTls(input.tlsMode);
    const id = crypto.randomUUID();
    const secretId = await this.vault.put(organizationId, "postgresql-password", input.password);
    try {
      const view = connectionFromInput(id, input);
      const [record] = await this.database
        .insert(dataConnections)
        .values({
          id,
          organizationId,
          slug: input.slug,
          name: input.name,
          kind: "postgresql",
          status: "draft",
          secretId,
          configuration: this.configurationFromView(view, null),
        })
        .returning();
      if (!record) throw new Error("Connection creation did not return a record.");
      return this.connectionView(record);
    } catch (error) {
      await this.vault.remove(organizationId, secretId);
      throw error;
    }
  }

  async updateConnection(
    organizationId: string,
    connectionId: string,
    input: UpdatePostgresConnectionInput,
  ): Promise<DataConnection> {
    const record = await this.requireConnectionRecord(organizationId, connectionId);
    const current = this.connectionView(record);
    const tlsMode = input.tlsMode ?? current.tlsMode;
    this.assertTls(tlsMode);
    if (input.password) {
      await this.vault.replace(
        organizationId,
        record.secretId,
        "postgresql-password",
        input.password,
      );
    }
    const [updated] = await this.database
      .update(dataConnections)
      .set({
        ...(input.name ? { name: input.name } : {}),
        configuration: {
          host: input.host ?? current.host,
          port: input.port ?? current.port,
          database: input.database ?? current.database,
          username: input.username ?? current.username,
          tlsMode,
          approvedTables: input.approvedTables ?? current.approvedTables,
          lastTestResult: null,
        } satisfies StoredConnectionConfiguration,
        status: "draft",
        lastTestedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataConnections.organizationId, organizationId),
          eq(dataConnections.id, connectionId),
        ),
      )
      .returning();
    if (!updated) throw new Error("Connection update did not return a record.");
    return this.connectionView(updated);
  }

  async testConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<ConnectionTestResult> {
    const record = await this.requireConnectionRecord(organizationId, connectionId);
    const connection = this.connectionView(record);
    const password = await this.vault.get(organizationId, record.secretId);
    const result = await this.inspector.test(connection, password);
    const configuration = this.parseConfiguration(record.configuration);
    await this.database
      .update(dataConnections)
      .set({
        configuration: { ...configuration, lastTestResult: result },
        lastTestedAt: new Date(result.testedAt),
        status: result.ok && connection.approvedTables.length > 0 ? "active" : "draft",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataConnections.organizationId, organizationId),
          eq(dataConnections.id, connectionId),
        ),
      );
    return result;
  }

  async setConnectionState(
    organizationId: string,
    connectionId: string,
    input: ConnectionStateInput,
  ): Promise<DataConnection> {
    const record = await this.requireConnectionRecord(organizationId, connectionId);
    if (input.confirmationName !== record.name) {
      throw new ControlApiError(422, "VALIDATION_FAILED", "Confirmation name does not match.");
    }
    const connection = this.connectionView(record);
    if (input.status === "active" && !connection.lastTestResult?.ok) {
      throw new ControlApiError(
        409,
        "CONFLICT",
        "The connection must pass a read-only safety test before activation.",
      );
    }
    const [updated] = await this.database
      .update(dataConnections)
      .set({
        status: input.status,
        disabledReason: input.status === "disabled" ? input.reason : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataConnections.organizationId, organizationId),
          eq(dataConnections.id, connectionId),
        ),
      )
      .returning();
    if (!updated) throw new Error("Connection state update did not return a record.");
    return this.connectionView(updated);
  }

  async removeConnection(organizationId: string, connectionId: string): Promise<void> {
    const record = await this.requireConnectionRecord(organizationId, connectionId);
    const dependencies = await this.database
      .select({ value: count() })
      .from(deployments)
      .innerJoin(activeDeployments, eq(activeDeployments.deploymentId, deployments.id))
      .innerJoin(capabilitySets, eq(capabilitySets.id, deployments.capabilitySetId))
      .where(
        and(
          eq(deployments.organizationId, organizationId),
          eq(deployments.environment, "production"),
          sql`exists (
            select 1
            from jsonb_array_elements(${capabilitySets.capabilities}) as capability
            where capability->>'kind' = 'external_postgres'
              and capability->>'connection' = ${record.slug}
          )`,
        ),
      );
    if (Number(dependencies[0]?.value ?? 0) > 0) {
      throw new ControlApiError(
        409,
        "CONFLICT",
        "Disable this connection instead; an active production deployment depends on it.",
      );
    }
    await this.database.transaction(async (transaction) => {
      await transaction
        .delete(dataConnections)
        .where(
          and(
            eq(dataConnections.organizationId, organizationId),
            eq(dataConnections.id, connectionId),
          ),
        );
    });
    await this.vault.remove(organizationId, record.secretId);
  }

  async listCatalog(organizationId: string, includeHidden: boolean): Promise<CatalogObject[]> {
    const rows = await this.database
      .select({ object: catalogObjects, connectionName: dataConnections.name })
      .from(catalogObjects)
      .innerJoin(dataConnections, eq(dataConnections.id, catalogObjects.connectionId))
      .where(
        includeHidden
          ? eq(catalogObjects.organizationId, organizationId)
          : and(
              eq(catalogObjects.organizationId, organizationId),
              inArray(catalogObjects.lifecycle, ["active", "deprecated"]),
              sql`${catalogObjects.sensitivity} <> 'restricted'`,
              eq(dataConnections.status, "active"),
            ),
      )
      .orderBy(
        dataConnections.name,
        catalogObjects.schemaName,
        catalogObjects.kind,
        catalogObjects.objectName,
      );
    return rows.map(({ object, connectionName }) => this.catalogView(object, connectionName));
  }

  async refreshCatalog(
    organizationId: string,
    connectionId: string,
    input: CatalogRefreshInput,
  ): Promise<CatalogRefreshResult> {
    const connectionRecord = await this.requireConnectionRecord(organizationId, connectionId);
    const connection = this.connectionView(connectionRecord);
    const password = await this.vault.get(organizationId, connectionRecord.secretId);
    const discovered = await this.inspector.discover(connection, password);
    const existing = await this.database
      .select()
      .from(catalogObjects)
      .where(
        and(
          eq(catalogObjects.organizationId, organizationId),
          eq(catalogObjects.connectionId, connectionId),
        ),
      );
    const currentByIdentity = new Map(
      existing.map((object) => [this.catalogIdentity(object), object] as const),
    );
    const discoveredByIdentity = new Map(
      discovered.map((object) => [this.discoveredIdentity(object), object] as const),
    );
    const additions = [...discoveredByIdentity.keys()].filter(
      (identity) => !currentByIdentity.has(identity),
    );
    const removals = [...currentByIdentity.keys()].filter(
      (identity) => !discoveredByIdentity.has(identity),
    );
    const changes = [...discoveredByIdentity.entries()].flatMap(([identity, next]) => {
      const current = currentByIdentity.get(identity);
      if (!current) return [];
      const result: { object: string; change: string; breaking: boolean }[] = [];
      if (current.dataType !== next.dataType) {
        result.push({
          object: identity,
          change: `type ${current.dataType ?? "none"} → ${next.dataType ?? "none"}`,
          breaking: true,
        });
      }
      if (current.nullable !== next.nullable) {
        result.push({
          object: identity,
          change: `nullable ${String(current.nullable)} → ${String(next.nullable)}`,
          breaking: current.nullable === true && next.nullable === false,
        });
      }
      return result;
    });
    const diffHash = createHash("sha256")
      .update(JSON.stringify({ additions: additions.sort(), changes, removals: removals.sort() }))
      .digest("hex");
    const currentVersion = Math.max(0, ...existing.map((object) => object.catalogVersion));
    if (!input.apply) {
      return {
        diffHash,
        additions: additions.length,
        changes,
        removals,
        applied: false,
        catalogVersion: Math.max(1, currentVersion),
      };
    }
    if (input.expectedDiffHash !== diffHash) {
      throw new ControlApiError(
        409,
        "CONFLICT",
        "Catalog metadata changed after preview; review the new diff before applying it.",
      );
    }
    const catalogVersion = currentVersion + 1;
    await this.applyCatalogRefresh(
      organizationId,
      connectionId,
      discovered,
      removals,
      catalogVersion,
    );
    return {
      diffHash,
      additions: additions.length,
      changes,
      removals,
      applied: true,
      catalogVersion,
    };
  }

  async updateCatalogObject(
    organizationId: string,
    objectId: string,
    input: UpdateCatalogObjectInput,
  ): Promise<CatalogObject> {
    const [updated] = await this.database
      .update(catalogObjects)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(eq(catalogObjects.organizationId, organizationId), eq(catalogObjects.id, objectId)),
      )
      .returning();
    if (!updated) throw new ControlApiError(404, "NOT_FOUND", "Catalog object not found.");
    const connection = await this.requireConnectionRecord(organizationId, updated.connectionId);
    return this.catalogView(updated, connection.name);
  }

  async listAudit(organizationId: string, filters: AuditFilters): Promise<AuditEventView[]> {
    const conditions = [eq(auditEvents.organizationId, organizationId)];
    if (filters.action) conditions.push(eq(auditEvents.action, filters.action));
    if (filters.outcome) conditions.push(eq(auditEvents.outcome, filters.outcome));
    if (filters.actor) {
      const actor = `%${filters.actor.toLowerCase().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      conditions.push(
        sql`(lower(coalesce(${users.name}, '')) like ${actor} escape '\\' or lower(coalesce(${users.email}, '')) like ${actor} escape '\\' or cast(${auditEvents.actorId} as text) = ${filters.actor})`,
      );
    }
    if (filters.actorId) conditions.push(eq(auditEvents.actorId, filters.actorId));
    if (filters.actorType) conditions.push(eq(auditEvents.actorType, filters.actorType));
    if (filters.target) {
      const target = `%${filters.target.toLowerCase().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      conditions.push(
        sql`(lower(${auditEvents.targetType}) like ${target} escape '\\' or lower(${auditEvents.targetId}) like ${target} escape '\\')`,
      );
    }
    if (filters.targetType) conditions.push(eq(auditEvents.targetType, filters.targetType));
    if (filters.environment) conditions.push(eq(auditEvents.environment, filters.environment));
    if (filters.requestId) conditions.push(eq(auditEvents.requestId, filters.requestId));
    if (filters.from) conditions.push(gte(auditEvents.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(auditEvents.occurredAt, filters.to));
    if (filters.appId) {
      conditions.push(
        sql`(${auditEvents.targetId} = ${filters.appId} or ${auditEvents.metadata}->>'appId' = ${filters.appId})`,
      );
    }
    const rows = await this.database
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(filters.limit)
      .offset(filters.offset);
    return rows.map(({ event, actorName }) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      actorType: event.actorType,
      actorId: event.actorId,
      actorName,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      environment: event.environment,
      requestId: event.requestId,
      outcome: event.outcome,
      metadata: (event.metadata ?? {}) as Record<string, unknown>,
    }));
  }

  private async appSummary(app: typeof apps.$inferSelect): Promise<AdminAppSummary> {
    const [owners, memberCount, active, lastUsage] = await Promise.all([
      this.database
        .select({ name: users.name })
        .from(appOwners)
        .innerJoin(organizationMemberships, eq(organizationMemberships.id, appOwners.membershipId))
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(eq(appOwners.appId, app.id)),
      this.database.select({ value: count() }).from(appMembers).where(eq(appMembers.appId, app.id)),
      this.database
        .select({ deployment: deployments, source: sourceVersions })
        .from(activeDeployments)
        .innerJoin(deployments, eq(deployments.id, activeDeployments.deploymentId))
        .innerJoin(sourceVersions, eq(sourceVersions.id, deployments.sourceVersionId))
        .where(
          and(eq(activeDeployments.appId, app.id), eq(activeDeployments.environment, "production")),
        )
        .limit(1),
      this.database
        .select({ occurredAt: max(usageEvents.occurredAt) })
        .from(usageEvents)
        .where(eq(usageEvents.appId, app.id)),
    ]);
    const deployment = active[0]?.deployment;
    return {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      lifecycle: app.lifecycle,
      ownerNames: owners.map((owner) => owner.name),
      activeVersion: active[0]?.source.id ?? null,
      lastDeploymentAt: deployment?.completedAt?.toISOString() ?? null,
      memberCount: Number(memberCount[0]?.value ?? 0),
      lastActivityAt: lastUsage[0]?.occurredAt?.toISOString() ?? null,
      health:
        app.lifecycle === "disabled"
          ? "disabled"
          : deployment?.status === "succeeded"
            ? "healthy"
            : deployment?.status === "failed"
              ? "degraded"
              : "inactive",
      disabledReason: app.disabledReason,
    };
  }

  private async requireApp(organizationId: string, appId: string) {
    const rows = await this.database
      .select()
      .from(apps)
      .where(and(eq(apps.organizationId, organizationId), eq(apps.id, appId)))
      .limit(1);
    if (!rows[0]) throw new ControlApiError(404, "NOT_FOUND", "App not found.");
    return rows[0];
  }

  private parseConfiguration(value: unknown): StoredConnectionConfiguration {
    const configuration = value as Partial<StoredConnectionConfiguration>;
    return {
      host: configuration.host ?? "",
      port: configuration.port ?? 5432,
      database: configuration.database ?? "",
      username: configuration.username ?? "",
      tlsMode: configuration.tlsMode ?? "verify-full",
      approvedTables: configuration.approvedTables ?? [],
      lastTestResult: configuration.lastTestResult ?? null,
    };
  }

  private configurationFromView(
    view: Omit<DataConnection, "lastTestResult">,
    lastTestResult: ConnectionTestResult | null,
  ): StoredConnectionConfiguration {
    return {
      host: view.host,
      port: view.port,
      database: view.database,
      username: view.username,
      tlsMode: view.tlsMode,
      approvedTables: view.approvedTables,
      lastTestResult,
    };
  }

  private connectionView(record: typeof dataConnections.$inferSelect): DataConnection {
    const configuration = this.parseConfiguration(record.configuration);
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      kind: "postgresql",
      status: record.status,
      host: configuration.host,
      port: configuration.port,
      database: configuration.database,
      username: configuration.username,
      tlsMode: configuration.tlsMode,
      approvedTables: configuration.approvedTables,
      disabledReason: record.disabledReason,
      lastTestedAt: record.lastTestedAt?.toISOString() ?? null,
      lastTestResult: configuration.lastTestResult,
    };
  }

  private async requireConnectionRecord(organizationId: string, connectionId: string) {
    const rows = await this.database
      .select()
      .from(dataConnections)
      .where(
        and(
          eq(dataConnections.organizationId, organizationId),
          eq(dataConnections.id, connectionId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ControlApiError(404, "NOT_FOUND", "Connection not found.");
    return rows[0];
  }

  private assertTls(tlsMode: string): void {
    if (tlsMode === "disable" && !this.allowInsecureTls) {
      throw new ControlApiError(
        422,
        "VALIDATION_FAILED",
        "TLS is required for PostgreSQL connections.",
      );
    }
  }

  private catalogIdentity(object: typeof catalogObjects.$inferSelect): string {
    return `${object.kind}:${object.schemaName}:${object.objectName}`;
  }

  private discoveredIdentity(object: DiscoveredCatalogObject): string {
    return `${object.kind}:${object.schemaName}:${object.objectName}`;
  }

  private catalogView(
    object: typeof catalogObjects.$inferSelect,
    connectionName: string,
  ): CatalogObject {
    return {
      id: object.id,
      connectionId: object.connectionId,
      connectionName,
      parentId: object.parentId,
      kind: object.kind as CatalogObject["kind"],
      schemaName: object.schemaName,
      objectName: object.objectName,
      dataType: object.dataType,
      nullable: object.nullable,
      lifecycle: object.lifecycle,
      sensitivity: object.sensitivity,
      description: object.description,
      businessOwner: object.businessOwner,
      sourceOfTruth: object.sourceOfTruth,
      catalogVersion: object.catalogVersion,
      metadata: (object.metadata ?? {}) as Record<string, unknown>,
    };
  }

  private async applyCatalogRefresh(
    organizationId: string,
    connectionId: string,
    discovered: DiscoveredCatalogObject[],
    removals: string[],
    catalogVersion: number,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const identityToId = new Map<string, string>();
      for (const object of discovered.sort(
        (left, right) =>
          ["schema", "table", "column"].indexOf(left.kind) -
          ["schema", "table", "column"].indexOf(right.kind),
      )) {
        const identity = this.discoveredIdentity(object);
        const parentId = object.parentIdentity
          ? (identityToId.get(object.parentIdentity) ?? null)
          : null;
        const existing = await transaction
          .select()
          .from(catalogObjects)
          .where(
            and(
              eq(catalogObjects.organizationId, organizationId),
              eq(catalogObjects.connectionId, connectionId),
              eq(catalogObjects.kind, object.kind),
              eq(catalogObjects.schemaName, object.schemaName),
              eq(catalogObjects.objectName, object.objectName),
            ),
          )
          .limit(1);
        if (existing[0]) {
          const [updated] = await transaction
            .update(catalogObjects)
            .set({
              parentId,
              dataType: object.dataType,
              nullable: object.nullable,
              metadata: object.metadata,
              catalogVersion,
              updatedAt: new Date(),
            })
            .where(eq(catalogObjects.id, existing[0].id))
            .returning();
          identityToId.set(identity, updated!.id);
        } else {
          const [created] = await transaction
            .insert(catalogObjects)
            .values({
              organizationId,
              connectionId,
              parentId,
              kind: object.kind,
              schemaName: object.schemaName,
              objectName: object.objectName,
              dataType: object.dataType,
              nullable: object.nullable,
              metadata: object.metadata,
              catalogVersion,
            })
            .returning();
          identityToId.set(identity, created!.id);
        }
      }
      for (const identity of removals) {
        const object = identity.split(":");
        await transaction
          .update(catalogObjects)
          .set({ lifecycle: "hidden", catalogVersion, updatedAt: new Date() })
          .where(
            and(
              eq(catalogObjects.organizationId, organizationId),
              eq(catalogObjects.connectionId, connectionId),
              eq(catalogObjects.kind, object[0] ?? ""),
              eq(catalogObjects.schemaName, object[1] ?? ""),
              eq(catalogObjects.objectName, object.slice(2).join(":")),
            ),
          );
      }
    });
  }
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
