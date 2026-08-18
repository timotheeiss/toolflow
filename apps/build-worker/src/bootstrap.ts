import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@toolflow/database";
import { createConfiguredObjectStore } from "@toolflow/object-store";
import { createBuildRunner } from "./app.js";
import { parseConfig } from "./config.js";

export function createBuildRunnerApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const database = createDatabase(config.DATABASE_URL);
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const objects = createConfiguredObjectStore({ filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH), environment, production: config.NODE_ENV === "production" });
  const app = createBuildRunner(database.db, objects, config.TOOLFLOW_BUILD_SERVICE_TOKEN ?? "development-build-service-token", {
    timeoutMs: config.TOOLFLOW_BUILD_TIMEOUT_MS, maximumArtifactBytes: config.TOOLFLOW_BUILD_MAX_ARTIFACT_BYTES,
  });
  return { app, close: () => database.close() };
}
