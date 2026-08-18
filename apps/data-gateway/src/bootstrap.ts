import { DatabaseAuditWriter } from "@toolflow/audit";
import { createDatabase } from "@toolflow/database";
import { RuntimeContextSigner } from "@toolflow/runtime-context";
import { createSecretVault } from "@toolflow/secrets";
import { createDataGateway } from "./app.js";
import { parseConfig } from "./config.js";
import { DatabaseSecretEnvelopeRepository } from "./secret-repository.js";

export function createDataGatewayApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const database = createDatabase(config.DATABASE_URL);
  const vault = createSecretVault(
    new DatabaseSecretEnvelopeRepository(database.db),
    config.TOOLFLOW_SECRET_BACKEND === "kms"
      ? { backend: "kms", brokerUrl: new URL(config.TOOLFLOW_KMS_URL!), serviceToken: config.TOOLFLOW_KMS_SERVICE_TOKEN!, keyId: config.TOOLFLOW_KMS_KEY_ID!, providerName: config.TOOLFLOW_KMS_PROVIDER_NAME }
      : { backend: "local", encryptionKey: Buffer.from(config.TOOLFLOW_SECRET_ENCRYPTION_KEY, "base64") },
  );
  const app = createDataGateway({
    database: database.db, pool: database.pool,
    signer: new RuntimeContextSigner(Buffer.from(config.TOOLFLOW_RUNTIME_CONTEXT_SECRET, "base64")),
    vault, audit: new DatabaseAuditWriter(database.db),
  });
  return { app, close: () => database.close() };
}
