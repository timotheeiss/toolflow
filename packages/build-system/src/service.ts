import { builds, runtimeVersions, sourceVersions, type ToolflowDatabase } from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import { and, asc, eq, lt } from "drizzle-orm";
import { compileSource, type BuildDiagnostic } from "./compiler.js";

type Database = ToolflowDatabase["db"];
type BuildRecord = typeof builds.$inferSelect;

export interface BuildServiceOptions {
  execution?: "inline" | "external";
  runner?: { url: string; token: string };
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export class BuildService {
  private readonly worker: BuildWorker;
  private readonly execution: "inline" | "external";
  private readonly runner: { url: string; token: string } | undefined;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly database: Database,
    objects: ImmutableObjectStore,
    options: BuildServiceOptions = {},
  ) {
    this.worker = new BuildWorker(database, objects, {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    this.execution = options.execution ?? "inline";
    this.runner = options.runner;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
  }

  async build(
    organizationId: string,
    appId: string,
    sourceVersionId: string,
  ): Promise<BuildRecord> {
    const build = await this.enqueue(organizationId, appId, sourceVersionId);
    if (this.execution === "inline") {
      await this.worker.run(build.id);
    } else {
      if (!this.runner) throw new Error("External build execution requires a build runner.");
      const response = await fetch(new URL(`/v1/builds/${build.id}`, this.runner.url), {
        method: "POST",
        headers: { authorization: `Bearer ${this.runner.token}` },
      });
      if (!response.ok) throw new Error("The external build runner rejected the build.");
    }
    return this.waitForTerminal(build.id);
  }

  async enqueue(
    organizationId: string,
    appId: string,
    sourceVersionId: string,
  ): Promise<BuildRecord> {
    const rows = await this.database
      .select({ source: sourceVersions, runtime: runtimeVersions })
      .from(sourceVersions)
      .innerJoin(runtimeVersions, eq(runtimeVersions.active, true))
      .where(
        and(
          eq(sourceVersions.organizationId, organizationId),
          eq(sourceVersions.appId, appId),
          eq(sourceVersions.id, sourceVersionId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("Source or active runtime version not found.");
    const [record] = await this.database
      .insert(builds)
      .values({
        organizationId,
        appId,
        sourceVersionId,
        runtimeVersionId: row.runtime.id,
        status: "queued",
      })
      .returning();
    if (!record) throw new Error("Build creation did not return a record.");
    return record;
  }

  async waitForTerminal(buildId: string): Promise<BuildRecord> {
    const deadline = Date.now() + this.timeoutMs + 10_000;
    while (Date.now() < deadline) {
      const [record] = await this.database
        .select()
        .from(builds)
        .where(eq(builds.id, buildId))
        .limit(1);
      if (!record) throw new Error("Build record disappeared.");
      if (record.status !== "queued" && record.status !== "running") return record;
      await delay(this.pollIntervalMs);
    }
    const [timedOut] = await this.database
      .update(builds)
      .set({ status: "timed_out", diagnostics: [timeoutDiagnostic()], completedAt: new Date() })
      .where(and(eq(builds.id, buildId), eq(builds.status, "queued")))
      .returning();
    if (timedOut) return timedOut;
    const [record] = await this.database
      .select()
      .from(builds)
      .where(eq(builds.id, buildId))
      .limit(1);
    if (!record) throw new Error("Build record disappeared.");
    return record;
  }
}

export interface BuildWorkerOptions {
  timeoutMs?: number;
  maximumArtifactBytes?: number;
}

export class BuildWorker {
  private readonly timeoutMs: number;
  private readonly maximumArtifactBytes: number;

  constructor(
    private readonly database: Database,
    private readonly objects: ImmutableObjectStore,
    options: BuildWorkerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
    this.maximumArtifactBytes = options.maximumArtifactBytes ?? 8 * 1024 * 1024;
  }

  async runNext(): Promise<boolean> {
    const [candidate] = await this.database
      .select({ id: builds.id })
      .from(builds)
      .where(eq(builds.status, "queued"))
      .orderBy(asc(builds.createdAt))
      .limit(1);
    return candidate ? this.run(candidate.id) : false;
  }

  async run(buildId: string): Promise<boolean> {
    const [claimed] = await this.database
      .update(builds)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(builds.id, buildId), eq(builds.status, "queued")))
      .returning();
    if (!claimed) return false;
    await this.execute(claimed);
    return true;
  }

  async pruneDiagnosticsBefore(cutoff: Date): Promise<void> {
    await this.database
      .update(builds)
      .set({ diagnostics: [] satisfies BuildDiagnostic[] })
      .where(lt(builds.completedAt, cutoff));
  }

  private async execute(record: BuildRecord): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [row] = await this.database
        .select({ source: sourceVersions, runtime: runtimeVersions })
        .from(sourceVersions)
        .innerJoin(runtimeVersions, eq(runtimeVersions.id, record.runtimeVersionId))
        .where(
          and(
            eq(sourceVersions.organizationId, record.organizationId),
            eq(sourceVersions.appId, record.appId),
            eq(sourceVersions.id, record.sourceVersionId),
          ),
        )
        .limit(1);
      if (!row) throw new Error("Immutable build inputs were not found.");
      const bundle = JSON.parse(
        new TextDecoder().decode(await this.objects.get(row.source.objectKey)),
      ) as unknown;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BuildTimedOutError()), this.timeoutMs);
      });
      const result = await Promise.race([
        compileSource(bundle, row.source.contentHash, row.runtime.version),
        timeout,
      ]);
      if (!result.artifact || !result.artifactHash) {
        await this.finish(record.id, "failed", result.diagnostics);
        return;
      }
      const artifactBytes = new TextEncoder().encode(JSON.stringify(result.artifact));
      if (artifactBytes.byteLength > this.maximumArtifactBytes) {
        await this.finish(record.id, "failed", [
          {
            phase: "bundle",
            code: "ARTIFACT_TOO_LARGE",
            message: `Artifact exceeds the ${this.maximumArtifactBytes} byte limit.`,
            remediation: "Reduce client or server bundle size.",
          },
        ]);
        return;
      }
      const artifactObjectKey = `artifacts/${result.artifactHash}.json`;
      await this.objects.put(artifactObjectKey, artifactBytes);
      await this.database
        .update(builds)
        .set({
          status: "succeeded",
          artifactHash: result.artifactHash,
          artifactObjectKey,
          diagnostics: [] satisfies BuildDiagnostic[],
          completedAt: new Date(),
        })
        .where(and(eq(builds.id, record.id), eq(builds.status, "running")));
    } catch (error) {
      if (error instanceof BuildTimedOutError) {
        await this.finish(record.id, "timed_out", [timeoutDiagnostic()]);
        return;
      }
      await this.finish(record.id, "failed", [
        {
          phase: "bundle",
          code: "BUILD_FAILED",
          message: safeMessage(error),
          remediation:
            "Retry the build. If it fails again, use the request ID to contact an administrator.",
        },
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async finish(
    buildId: string,
    status: "failed" | "timed_out",
    diagnostics: BuildDiagnostic[],
  ): Promise<void> {
    await this.database
      .update(builds)
      .set({ status, diagnostics, completedAt: new Date() })
      .where(and(eq(builds.id, buildId), eq(builds.status, "running")));
  }
}

class BuildTimedOutError extends Error {}

function timeoutDiagnostic(): BuildDiagnostic {
  return {
    phase: "bundle",
    code: "BUILD_TIMEOUT",
    message: "Build exceeded the five-minute execution limit.",
    remediation: "Reduce build complexity or app test duration.",
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Build failed.";
  return message
    .replace(/(authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 4_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
