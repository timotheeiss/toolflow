import { createHash } from "node:crypto";
import { AppSchemaService } from "@toolflow/app-data";
import type { Principal } from "@toolflow/auth";
import { appCapabilitySchema, type AppCapability } from "@toolflow/contracts";
import {
  activeDeployments,
  appDataSpaces,
  appOwners,
  appRoutes,
  apps,
  builds,
  capabilitySets,
  dataConnections,
  deployments,
  idempotencyRecords,
  organizationMemberships,
  runtimeVersions,
  schemaPlans,
  schemaVersions,
  runtimeAppUrl,
  type ToolflowDatabase,
} from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { ToolflowArtifact } from "@toolflow/build-system";
import { canManageApp } from "@toolflow/policy";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { LifecycleError } from "./preview.js";
import { LocalRuntimePublisher, type RuntimePublisher } from "./publisher.js";

interface ProductionDeployInput {
  appId: string;
  buildId: string;
  idempotencyKey: string;
}

interface RollbackInput {
  appId: string;
  targetDeploymentId: string;
  reason: string;
  idempotencyKey: string;
}

export class ProductionDeploymentService {
  private readonly schemas: AppSchemaService;

  constructor(
    private readonly database: ToolflowDatabase["db"],
    pool: Pool,
    private readonly objects: ImmutableObjectStore,
    private readonly runtimeBaseUrl: string,
    private readonly publisher: RuntimePublisher = new LocalRuntimePublisher(),
  ) {
    this.schemas = new AppSchemaService(database, pool);
  }

  async deploy(principal: Principal, input: ProductionDeployInput) {
    const replay = await this.readIdempotency(
      principal,
      "deploy_production",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    const candidate = await this.candidate(principal, input);
    const artifact = await this.preflight(candidate.target.build.artifactObjectKey);
    if (candidate.plan) {
      await this.schemas.applyProduction(principal.organizationId, candidate.plan.id);
    }
    const startedAt = new Date();
    const [deployment] = await this.database
      .insert(deployments)
      .values({
        organizationId: principal.organizationId,
        appId: input.appId,
        environment: "production",
        actorMembershipId: principal.membershipId,
        sourceVersionId: candidate.target.build.sourceVersionId,
        buildId: candidate.target.build.id,
        capabilitySetId: candidate.target.capabilities.id,
        schemaVersionId: candidate.target.schema.id,
        runtimeVersionId: candidate.target.runtime.id,
        artifactHash: candidate.target.build.artifactHash!,
        status: "running",
        startedAt,
      })
      .returning();
    if (!deployment) throw new Error("Production deployment creation did not return a record.");
    const completedAt = new Date();
    const productionUrl = runtimeAppUrl(this.runtimeBaseUrl, candidate.routes.production, {
      organizationId: principal.organizationId,
      appSlug: candidate.target.app.slug,
      environment: "production",
    });
    try {
      const published = await this.publisher.publish({
        deploymentId: deployment.id,
        organizationId: principal.organizationId,
        appId: input.appId,
        appSlug: candidate.target.app.slug,
        environment: "production",
        artifactHash: candidate.target.build.artifactHash!,
        artifact,
      });
      await this.database.transaction(async (transaction) => {
        await transaction
          .update(deployments)
          .set({
            status: "succeeded",
            providerDeploymentId: published.providerDeploymentId,
            completedAt,
          })
          .where(and(eq(deployments.id, deployment.id), eq(deployments.status, "running")));
        const activated = candidate.current
          ? await transaction
              .update(activeDeployments)
              .set({ deploymentId: deployment.id, updatedAt: completedAt })
              .where(
                and(
                  eq(activeDeployments.appId, input.appId),
                  eq(activeDeployments.environment, "production"),
                  eq(activeDeployments.deploymentId, candidate.current.deployment.id),
                ),
              )
              .returning({ deploymentId: activeDeployments.deploymentId })
          : await transaction
              .insert(activeDeployments)
              .values({
                appId: input.appId,
                environment: "production",
                deploymentId: deployment.id,
                updatedAt: completedAt,
              })
              .onConflictDoNothing()
              .returning({ deploymentId: activeDeployments.deploymentId });
        if (activated.length !== 1) {
          throw new LifecycleError(
            "CONFLICT",
            "Active production changed while deployment was being activated.",
          );
        }
        await transaction
          .update(apps)
          .set({ lifecycle: "production", updatedAt: completedAt })
          .where(and(eq(apps.id, input.appId), eq(apps.organizationId, principal.organizationId)));
        await transaction
          .update(appRoutes)
          .set({ url: productionUrl })
          .where(and(eq(appRoutes.appId, input.appId), eq(appRoutes.environment, "production")));
      });
    } catch (error) {
      await this.database
        .update(deployments)
        .set({
          status: "failed",
          failure: { code: "ACTIVATION_FAILED" },
          completedAt: new Date(),
        })
        .where(eq(deployments.id, deployment.id));
      throw error;
    }
    const result = {
      id: deployment.id,
      appId: input.appId,
      environment: "production" as const,
      status: "succeeded" as const,
      url: productionUrl,
      artifactHash: candidate.target.build.artifactHash!,
      sourceVersionId: candidate.target.build.sourceVersionId,
      schemaPlanId: candidate.plan?.id ?? null,
      previousDeploymentId: candidate.current?.deployment.id ?? null,
      createdAt: completedAt.toISOString(),
    };
    await this.writeIdempotency(
      principal,
      "deploy_production",
      input.idempotencyKey,
      input,
      result,
    );
    return result;
  }

  async rollback(principal: Principal, input: RollbackInput) {
    const replay = await this.readIdempotency(
      principal,
      "rollback_app",
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    const ownerRows = await this.database
      .select({ membershipId: appOwners.membershipId, status: organizationMemberships.status })
      .from(appOwners)
      .innerJoin(organizationMemberships, eq(organizationMemberships.id, appOwners.membershipId))
      .where(eq(appOwners.appId, input.appId));
    if (
      !canManageApp(
        principal.role,
        principal.membershipId,
        ownerRows.map((owner) => owner.membershipId),
      )
    ) {
      throw new LifecycleError("AUTHORIZATION_DENIED", "Rollback access is denied.");
    }
    if (!ownerRows.some((owner) => owner.status === "active")) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "A production app must retain an active owner.",
      );
    }
    const targetRows = await this.database
      .select({
        deployment: deployments,
        app: apps,
        build: builds,
        runtime: runtimeVersions,
        capabilities: capabilitySets,
        schema: schemaVersions,
        routeKey: appRoutes.routeKey,
      })
      .from(deployments)
      .innerJoin(apps, eq(apps.id, deployments.appId))
      .innerJoin(
        appRoutes,
        and(eq(appRoutes.appId, deployments.appId), eq(appRoutes.environment, "production")),
      )
      .innerJoin(builds, eq(builds.id, deployments.buildId))
      .innerJoin(runtimeVersions, eq(runtimeVersions.id, deployments.runtimeVersionId))
      .innerJoin(capabilitySets, eq(capabilitySets.id, deployments.capabilitySetId))
      .innerJoin(schemaVersions, eq(schemaVersions.id, deployments.schemaVersionId))
      .where(
        and(
          eq(deployments.id, input.targetDeploymentId),
          eq(deployments.organizationId, principal.organizationId),
          eq(deployments.appId, input.appId),
          eq(deployments.environment, "production"),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new LifecycleError("NOT_FOUND", "Rollback target was not found.");
    const currentRows = await this.database
      .select({ deployment: deployments })
      .from(activeDeployments)
      .innerJoin(deployments, eq(deployments.id, activeDeployments.deploymentId))
      .where(
        and(
          eq(activeDeployments.appId, input.appId),
          eq(activeDeployments.environment, "production"),
        ),
      )
      .limit(1);
    const current = currentRows[0];
    if (!current)
      throw new LifecycleError("NOT_FOUND", "Active production deployment was not found.");
    if (current.deployment.id === target.deployment.id) {
      throw new LifecycleError("CONFLICT", "The selected deployment is already active.");
    }
    const targetCapabilities = parseCapabilities(target.capabilities.capabilities);
    await this.validateExternalCapabilities(principal.organizationId, targetCapabilities);
    const rollbackWarning = "App-owned additive schema changes are not reversed.";
    const artifact = await this.preflight(target.build.artifactObjectKey);
    const startedAt = new Date();
    const [rollback] = await this.database
      .insert(deployments)
      .values({
        organizationId: principal.organizationId,
        appId: input.appId,
        environment: "production",
        actorMembershipId: principal.membershipId,
        sourceVersionId: target.deployment.sourceVersionId,
        buildId: target.build.id,
        capabilitySetId: target.capabilities.id,
        schemaVersionId: target.schema.id,
        runtimeVersionId: target.runtime.id,
        artifactHash: target.deployment.artifactHash,
        status: "running",
        startedAt,
      })
      .returning();
    if (!rollback) throw new Error("Rollback deployment creation failed.");
    const completedAt = new Date();
    const productionUrl = runtimeAppUrl(this.runtimeBaseUrl, target.routeKey, {
      organizationId: principal.organizationId,
      appSlug: target.app.slug,
      environment: "production",
    });
    try {
      const published = await this.publisher.publish({
        deploymentId: rollback.id,
        organizationId: principal.organizationId,
        appId: input.appId,
        appSlug: target.app.slug,
        environment: "production",
        artifactHash: target.deployment.artifactHash,
        artifact,
      });
      await this.database.transaction(async (transaction) => {
        await transaction
          .update(deployments)
          .set({
            status: "succeeded",
            providerDeploymentId: published.providerDeploymentId,
            completedAt,
          })
          .where(and(eq(deployments.id, rollback.id), eq(deployments.status, "running")));
        const activated = await transaction
          .update(activeDeployments)
          .set({ deploymentId: rollback.id, updatedAt: completedAt })
          .where(
            and(
              eq(activeDeployments.appId, input.appId),
              eq(activeDeployments.environment, "production"),
              eq(activeDeployments.deploymentId, current.deployment.id),
            ),
          )
          .returning({ deploymentId: activeDeployments.deploymentId });
        if (activated.length !== 1) {
          throw new LifecycleError(
            "CONFLICT",
            "Active production changed while rollback was being activated.",
          );
        }
        await transaction
          .update(appRoutes)
          .set({ url: productionUrl })
          .where(and(eq(appRoutes.appId, input.appId), eq(appRoutes.environment, "production")));
      });
    } catch (error) {
      await this.database
        .update(deployments)
        .set({
          status: "failed",
          failure: { code: "ROLLBACK_ACTIVATION_FAILED" },
          completedAt: new Date(),
        })
        .where(eq(deployments.id, rollback.id));
      throw error;
    }
    const result = {
      id: rollback.id,
      appId: input.appId,
      status: "succeeded" as const,
      environment: "production" as const,
      sourceDeploymentId: current.deployment.id,
      targetDeploymentId: target.deployment.id,
      reason: input.reason,
      warning: rollbackWarning,
      url: productionUrl,
      createdAt: completedAt.toISOString(),
    };
    await this.writeIdempotency(principal, "rollback_app", input.idempotencyKey, input, result);
    return result;
  }

  private async candidate(principal: Principal, input: ProductionDeployInput) {
    const targetRows = await this.database
      .select({
        app: apps,
        build: builds,
        runtime: runtimeVersions,
        capabilities: capabilitySets,
        schema: schemaVersions,
      })
      .from(builds)
      .innerJoin(apps, eq(apps.id, builds.appId))
      .innerJoin(runtimeVersions, eq(runtimeVersions.id, builds.runtimeVersionId))
      .innerJoin(capabilitySets, eq(capabilitySets.sourceVersionId, builds.sourceVersionId))
      .innerJoin(schemaVersions, eq(schemaVersions.sourceVersionId, builds.sourceVersionId))
      .where(
        and(
          eq(builds.id, input.buildId),
          eq(builds.appId, input.appId),
          eq(builds.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new LifecycleError("NOT_FOUND", "Production build was not found.");
    const routeRows = await this.database
      .select({ routeKey: appRoutes.routeKey, environment: appRoutes.environment })
      .from(appRoutes)
      .where(
        and(
          eq(appRoutes.organizationId, principal.organizationId),
          eq(appRoutes.appId, input.appId),
        ),
      );
    const previewRoute = routeRows.find((route) => route.environment === "preview")?.routeKey;
    const productionRoute = routeRows.find((route) => route.environment === "production")?.routeKey;
    if (!previewRoute || !productionRoute) {
      throw new LifecycleError("DEPENDENCY_FAILED", "Trusted app route mapping is missing.");
    }
    const routes = { preview: previewRoute, production: productionRoute };
    if (
      target.build.status !== "succeeded" ||
      !target.build.artifactHash ||
      !target.build.artifactObjectKey
    ) {
      throw new LifecycleError("VALIDATION_FAILED", "Production requires a successful build.");
    }
    if (["disabled", "orphaned", "archived"].includes(target.app.lifecycle)) {
      throw new LifecycleError("CONFLICT", `A ${target.app.lifecycle} app cannot be deployed.`);
    }
    const ownerRows = await this.database
      .select({ membershipId: appOwners.membershipId, status: organizationMemberships.status })
      .from(appOwners)
      .innerJoin(organizationMemberships, eq(organizationMemberships.id, appOwners.membershipId))
      .where(eq(appOwners.appId, input.appId));
    if (
      !canManageApp(
        principal.role,
        principal.membershipId,
        ownerRows.map((owner) => owner.membershipId),
      )
    ) {
      throw new LifecycleError("AUTHORIZATION_DENIED", "Production access is denied.");
    }
    if (!ownerRows.some((owner) => owner.status === "active")) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "A production app must retain an active owner.",
      );
    }
    const previewRows = await this.database
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.organizationId, principal.organizationId),
          eq(deployments.appId, input.appId),
          eq(deployments.buildId, input.buildId),
          eq(deployments.environment, "preview"),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    if (!previewRows[0]) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "A successful preview of this exact build is required.",
      );
    }
    const spaces = await this.database
      .select()
      .from(appDataSpaces)
      .where(and(eq(appDataSpaces.appId, input.appId), eq(appDataSpaces.environment, "production")))
      .limit(1);
    const space = spaces[0];
    if (!space) throw new LifecycleError("NOT_FOUND", "Production data space was not found.");
    let plan: typeof schemaPlans.$inferSelect | null = null;
    if (space.activeSchemaVersionId !== target.schema.id) {
      const planned = await this.schemas.plan(principal, {
        appId: input.appId,
        sourceVersionId: target.build.sourceVersionId,
        environment: "production",
      });
      const plans = await this.database
        .select()
        .from(schemaPlans)
        .where(
          and(
            eq(schemaPlans.id, planned.id),
            eq(schemaPlans.organizationId, principal.organizationId),
            eq(schemaPlans.appId, input.appId),
            eq(schemaPlans.environment, "production"),
          ),
        )
        .limit(1);
      plan = plans[0] ?? null;
      if (
        !plan ||
        plan.fromSchemaVersionId !== space.activeSchemaVersionId ||
        plan.toSchemaVersionId !== target.schema.id
      ) {
        throw new LifecycleError(
          "VALIDATION_FAILED",
          "Production schema plan does not match the active and requested schemas.",
        );
      }
    }
    const currentRows = await this.database
      .select({ deployment: deployments })
      .from(activeDeployments)
      .innerJoin(deployments, eq(deployments.id, activeDeployments.deploymentId))
      .where(
        and(
          eq(activeDeployments.appId, input.appId),
          eq(activeDeployments.environment, "production"),
          eq(deployments.status, "succeeded"),
        ),
      )
      .limit(1);
    const current = currentRows[0] ?? null;
    const requestedCapabilities = parseCapabilities(target.capabilities.capabilities);
    await this.validateExternalCapabilities(principal.organizationId, requestedCapabilities);
    return { target, current, plan, routes };
  }

  private async validateExternalCapabilities(
    organizationId: string,
    capabilities: AppCapability[],
  ) {
    const requested = capabilities.filter(
      (capability): capability is Extract<AppCapability, { kind: "external_postgres" }> =>
        capability.kind === "external_postgres",
    );
    if (requested.length === 0) return;
    const connections = await this.database
      .select()
      .from(dataConnections)
      .where(
        and(
          eq(dataConnections.organizationId, organizationId),
          eq(dataConnections.status, "active"),
        ),
      );
    for (const capability of requested) {
      const connection = connections.find((candidate) => candidate.slug === capability.connection);
      const configuration = connection?.configuration as
        { approvedTables?: { schema?: unknown; table?: unknown }[] } | undefined;
      const allowed = configuration?.approvedTables?.some(
        (table) => table.schema === capability.schema && table.table === capability.table,
      );
      if (!connection || !allowed) {
        throw new LifecycleError(
          "VALIDATION_FAILED",
          `External capability ${capability.connection}:${capability.schema}.${capability.table} is not currently approved.`,
        );
      }
    }
  }

  private async preflight(objectKey: string | null): Promise<ToolflowArtifact> {
    if (!objectKey) throw new LifecycleError("VALIDATION_FAILED", "Build artifact is unavailable.");
    const artifact = JSON.parse(
      new TextDecoder().decode(await this.objects.get(objectKey)),
    ) as ToolflowArtifact;
    if (!artifact.html || !artifact.clientJavaScript || !artifact.serverJavaScript) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "Build artifact failed the production health preflight.",
      );
    }
    return artifact;
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
    if (record.requestHash !== hash(stableJson(request))) {
      throw new LifecycleError("CONFLICT", "Idempotency key was used with another request.");
    }
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

function parseCapabilities(value: unknown): AppCapability[] {
  return appCapabilitySchema.array().parse(value);
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
