import { createHash } from "node:crypto";
import type { Principal } from "@toolflow/auth";
import {
  activeDeployments,
  appDataSpaces,
  appOwners,
  appRoutes,
  apps,
  builds,
  capabilitySets,
  deployments,
  idempotencyRecords,
  runtimeVersions,
  schemaVersions,
  runtimeAppUrl,
  type ToolflowDatabase,
} from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { ToolflowArtifact } from "@toolflow/build-system";
import { canManageApp } from "@toolflow/policy";
import { and, desc, eq } from "drizzle-orm";
import { LocalRuntimePublisher, type RuntimePublisher } from "./publisher.js";

export class LifecycleError extends Error {
  constructor(
    readonly code:
      "AUTHORIZATION_DENIED" | "CONFLICT" | "DEPENDENCY_FAILED" | "NOT_FOUND" | "VALIDATION_FAILED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface PreviewDeploymentResult {
  id: string;
  appId: string;
  environment: "preview";
  status: "succeeded";
  url: string;
  artifactHash: string;
  sourceVersionId: string;
  createdAt: string;
}

export class DeploymentService {
  constructor(
    private readonly database: ToolflowDatabase["db"],
    private readonly objects: ImmutableObjectStore,
    private readonly runtimeBaseUrl: string,
    private readonly publisher: RuntimePublisher = new LocalRuntimePublisher(),
  ) {}

  async createPreview(
    principal: Principal,
    input: { appId: string; buildId: string; idempotencyKey: string },
  ): Promise<PreviewDeploymentResult> {
    await this.assertCanManage(principal, input.appId);
    const requestHash = hash(JSON.stringify(input));
    const replay = await this.readIdempotency(
      principal,
      "create_preview",
      input.idempotencyKey,
      requestHash,
    );
    if (replay) return replay as unknown as PreviewDeploymentResult;
    const rows = await this.database
      .select({
        build: builds,
        app: apps,
        runtime: runtimeVersions,
        capabilities: capabilitySets,
        schema: schemaVersions,
        dataSpace: appDataSpaces,
        routeKey: appRoutes.routeKey,
      })
      .from(builds)
      .innerJoin(apps, eq(apps.id, builds.appId))
      .innerJoin(
        appRoutes,
        and(eq(appRoutes.appId, builds.appId), eq(appRoutes.environment, "preview")),
      )
      .innerJoin(runtimeVersions, eq(runtimeVersions.id, builds.runtimeVersionId))
      .innerJoin(capabilitySets, eq(capabilitySets.sourceVersionId, builds.sourceVersionId))
      .leftJoin(schemaVersions, eq(schemaVersions.sourceVersionId, builds.sourceVersionId))
      .innerJoin(
        appDataSpaces,
        and(eq(appDataSpaces.appId, builds.appId), eq(appDataSpaces.environment, "preview")),
      )
      .where(
        and(
          eq(builds.organizationId, principal.organizationId),
          eq(builds.appId, input.appId),
          eq(builds.id, input.buildId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new LifecycleError("NOT_FOUND", "Build not found.");
    if (
      row.app.lifecycle === "disabled" ||
      row.app.lifecycle === "orphaned" ||
      row.app.lifecycle === "archived"
    ) {
      throw new LifecycleError(
        "CONFLICT",
        `A ${row.app.lifecycle} app cannot receive deployments.`,
      );
    }
    if (
      row.build.status !== "succeeded" ||
      !row.build.artifactHash ||
      !row.build.artifactObjectKey
    ) {
      throw new LifecycleError("VALIDATION_FAILED", "Only a successful build can be deployed.");
    }
    if (!row.schema || row.dataSpace.activeSchemaVersionId !== row.schema.id) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "Apply an additive preview schema plan for this source version before deployment.",
        {
          activeSchemaVersionId: row.dataSpace.activeSchemaVersionId,
          requiredSchemaVersionId: row.schema?.id ?? null,
        },
      );
    }
    const artifact = JSON.parse(
      new TextDecoder().decode(await this.objects.get(row.build.artifactObjectKey)),
    ) as ToolflowArtifact;
    if (
      !artifact.html ||
      !artifact.clientJavaScript ||
      !artifact.serverJavaScript ||
      artifact.sourceHash === undefined
    ) {
      throw new LifecycleError(
        "VALIDATION_FAILED",
        "Build artifact failed the deployment health preflight.",
      );
    }
    const [deployment] = await this.database
      .insert(deployments)
      .values({
        organizationId: principal.organizationId,
        appId: input.appId,
        environment: "preview",
        actorMembershipId: principal.membershipId,
        sourceVersionId: row.build.sourceVersionId,
        buildId: row.build.id,
        capabilitySetId: row.capabilities.id,
        schemaVersionId: row.schema?.id,
        runtimeVersionId: row.runtime.id,
        artifactHash: row.build.artifactHash,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    if (!deployment) throw new Error("Preview deployment creation did not return a record.");
    const completedAt = new Date();
    try {
      const published = await this.publisher.publish({
        deploymentId: deployment.id,
        organizationId: principal.organizationId,
        appId: input.appId,
        appSlug: row.app.slug,
        environment: "preview",
        artifactHash: row.build.artifactHash,
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
          .where(eq(deployments.id, deployment.id));
        await transaction
          .insert(activeDeployments)
          .values({
            appId: input.appId,
            environment: "preview",
            deploymentId: deployment.id,
            updatedAt: completedAt,
          })
          .onConflictDoUpdate({
            target: [activeDeployments.appId, activeDeployments.environment],
            set: { deploymentId: deployment.id, updatedAt: completedAt },
          });
        await transaction
          .update(apps)
          .set({
            lifecycle: row.app.lifecycle === "production" ? "production" : "preview",
            updatedAt: completedAt,
          })
          .where(and(eq(apps.organizationId, principal.organizationId), eq(apps.id, input.appId)));
      });
    } catch (error) {
      await this.database
        .update(deployments)
        .set({
          status: "failed",
          failure: { code: "PUBLICATION_OR_HEALTH_FAILED" },
          completedAt: new Date(),
        })
        .where(eq(deployments.id, deployment.id));
      throw new LifecycleError(
        "DEPENDENCY_FAILED",
        error instanceof Error ? error.message : "Preview publication failed.",
      );
    }
    const result: PreviewDeploymentResult = {
      id: deployment.id,
      appId: input.appId,
      environment: "preview",
      status: "succeeded",
      url: this.appUrl(row.app.slug, "preview", row.routeKey, principal.organizationId),
      artifactHash: row.build.artifactHash,
      sourceVersionId: row.build.sourceVersionId,
      createdAt: completedAt.toISOString(),
    };
    await this.writeIdempotency(
      principal,
      "create_preview",
      input.idempotencyKey,
      requestHash,
      result,
    );
    return result;
  }

  async status(principal: Principal, appId: string) {
    await this.assertCanManage(principal, appId);
    const rows = await this.database
      .select({
        deployment: deployments,
        appSlug: apps.slug,
        routeKey: appRoutes.routeKey,
      })
      .from(deployments)
      .innerJoin(apps, eq(apps.id, deployments.appId))
      .innerJoin(
        appRoutes,
        and(
          eq(appRoutes.appId, deployments.appId),
          eq(appRoutes.environment, deployments.environment),
        ),
      )
      .where(
        and(eq(deployments.organizationId, principal.organizationId), eq(deployments.appId, appId)),
      )
      .orderBy(desc(deployments.createdAt))
      .limit(20);
    return rows.map(({ deployment, appSlug, routeKey }) => ({
      id: deployment.id,
      environment: deployment.environment,
      status: deployment.status,
      sourceVersionId: deployment.sourceVersionId,
      artifactHash: deployment.artifactHash,
      url: this.appUrl(appSlug, deployment.environment, routeKey, principal.organizationId),
      createdAt: deployment.createdAt.toISOString(),
      completedAt: deployment.completedAt?.toISOString() ?? null,
      failure: deployment.failure,
    }));
  }

  private appUrl(
    slug: string,
    environment: "preview" | "production",
    routeKey: string,
    organizationId: string,
  ) {
    return runtimeAppUrl(this.runtimeBaseUrl, routeKey, {
      organizationId,
      appSlug: slug,
      environment,
    });
  }

  private async assertCanManage(principal: Principal, appId: string) {
    const appRows = await this.database
      .select()
      .from(apps)
      .where(and(eq(apps.organizationId, principal.organizationId), eq(apps.id, appId)))
      .limit(1);
    if (!appRows[0]) throw new LifecycleError("NOT_FOUND", "App not found.");
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
      throw new LifecycleError("AUTHORIZATION_DENIED", "Deployment access is denied.");
  }

  private async readIdempotency(
    principal: Principal,
    operation: string,
    key: string,
    requestHash: string,
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
    if (!rows[0]) return null;
    if (rows[0].requestHash !== requestHash)
      throw new LifecycleError(
        "CONFLICT",
        "Idempotency key was already used with a different request.",
      );
    return rows[0].response;
  }

  private async writeIdempotency(
    principal: Principal,
    operation: string,
    key: string,
    requestHash: string,
    response: unknown,
  ) {
    await this.database
      .insert(idempotencyRecords)
      .values({
        organizationId: principal.organizationId,
        actorId: principal.userId,
        operation,
        key,
        requestHash,
        statusCode: 200,
        response,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .onConflictDoNothing();
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
