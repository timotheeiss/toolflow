import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BuildWorker } from "@toolflow/build-system";
import { createDatabase } from "@toolflow/database";
import { createConfiguredObjectStore } from "@toolflow/object-store";
import { createBuildRunner } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig(process.env);
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const database = createDatabase(config.DATABASE_URL);
const worker = new BuildWorker(
  database.db,
  createConfiguredObjectStore({
    filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH),
    environment: process.env,
    production: config.NODE_ENV === "production",
  }),
  {
    timeoutMs: config.TOOLFLOW_BUILD_TIMEOUT_MS,
    maximumArtifactBytes: config.TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES,
  },
);
export const app = createBuildRunner(
  database.db,
  createConfiguredObjectStore({
    filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH),
    environment: process.env,
    production: config.NODE_ENV === "production",
  }),
  config.TOOLFLOW_BUILD_SERVICE_TOKEN ?? "development-build-service-token",
  {
    timeoutMs: config.TOOLFLOW_BUILD_TIMEOUT_MS,
    maximumArtifactBytes: config.TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES,
  },
);
let stopping = false;
let nextRetentionSweep = 0;

async function work(): Promise<void> {
  while (!stopping) {
    if (Date.now() >= nextRetentionSweep) {
      await worker.pruneDiagnosticsBefore(
        new Date(Date.now() - config.TOOLFLOW_BUILD_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1_000),
      );
      nextRetentionSweep = Date.now() + 24 * 60 * 60 * 1_000;
    }
    const handled = await worker.runNext();
    if (!handled) await delay(config.TOOLFLOW_BUILD_POLL_INTERVAL_MS);
  }
}

async function shutdown(): Promise<void> {
  stopping = true;
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
void work();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
