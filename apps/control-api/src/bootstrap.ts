import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkOS } from "@workos-inc/node";
import { DatabaseAuditWriter } from "@toolflow/audit";
import {
  BearerRequestAuthenticator,
  CompositeRequestAuthenticator,
  DevelopmentHeaderAuthenticator,
  JwksAccessTokenVerifier,
  WorkOsSessionAuthenticator,
  type RequestAuthenticator,
} from "@toolflow/auth";
import { createDatabase, PostgresRateLimiter } from "@toolflow/database";
import { createConfiguredObjectStore } from "@toolflow/object-store";
import { createSecretVault } from "@toolflow/secrets";
import { createControlApi } from "./app.js";
import { AuthKitController } from "./authkit.js";
import { DatabaseAdminStore } from "./admin-store.js";
import { PostgresConnectionInspector } from "./connection-inspector.js";
import { parseConfig } from "./config.js";
import { DatabaseGovernanceStore } from "./governance-store.js";
import { DatabaseMembershipIdentityRepository } from "./membership-repository.js";
import { DatabaseSecretEnvelopeRepository } from "./secret-repository.js";
import { WorkOsInvitationSender, type InvitationSender } from "./workos-invitations.js";

export function createControlApiApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const database = createDatabase(config.DATABASE_URL);
  const audit = new DatabaseAuditWriter(database.db);
  const vault = createSecretVault(
    new DatabaseSecretEnvelopeRepository(database.db),
    config.TOOLFLOW_SECRET_BACKEND === "kms"
      ? { backend: "kms", brokerUrl: new URL(config.TOOLFLOW_KMS_URL!), serviceToken: config.TOOLFLOW_KMS_SERVICE_TOKEN!, keyId: config.TOOLFLOW_KMS_KEY_ID!, providerName: config.TOOLFLOW_KMS_PROVIDER_NAME }
      : { backend: "local", encryptionKey: Buffer.from(config.TOOLFLOW_SECRET_ENCRYPTION_KEY, "base64") },
  );
  let authenticator: RequestAuthenticator;
  let authKit: AuthKitController | undefined;
  let invitationSender: InvitationSender | undefined;
  if (config.TOOLFLOW_AUTH_MODE === "development") {
    authenticator = new DevelopmentHeaderAuthenticator();
  } else {
    const memberships = new DatabaseMembershipIdentityRepository(database.db);
    const workos = new WorkOS({ apiKey: config.WORKOS_API_KEY!, clientId: config.WORKOS_CLIENT_ID! });
    const sessionAuthenticator = new WorkOsSessionAuthenticator(workos, memberships, config.WORKOS_COOKIE_PASSWORD!, {
      secure: config.NODE_ENV === "production",
      ...(config.TOOLFLOW_COOKIE_DOMAIN ? { domain: config.TOOLFLOW_COOKIE_DOMAIN } : {}),
    });
    authenticator = new CompositeRequestAuthenticator([
      sessionAuthenticator,
      new BearerRequestAuthenticator(new JwksAccessTokenVerifier({ issuer: config.WORKOS_ISSUER!, audience: config.WORKOS_AUDIENCE!, jwksUrl: config.WORKOS_JWKS_URL! }), memberships),
    ]);
    authKit = new AuthKitController(workos, database.db, sessionAuthenticator, audit, {
      clientId: config.WORKOS_CLIENT_ID!, cookiePassword: config.WORKOS_COOKIE_PASSWORD!, redirectUri: config.WORKOS_REDIRECT_URI,
      applicationUrl: config.TOOLFLOW_ADMIN_ORIGIN, secure: config.NODE_ENV === "production",
      ...(config.TOOLFLOW_COOKIE_DOMAIN ? { cookieDomain: config.TOOLFLOW_COOKIE_DOMAIN } : {}),
    });
    invitationSender = new WorkOsInvitationSender(workos, database.db);
  }
  const app = createControlApi({
    authenticator, audit, adminStore: new DatabaseAdminStore(database.db),
    governanceStore: new DatabaseGovernanceStore(database.db, vault, new PostgresConnectionInspector(), config.TOOLFLOW_ALLOW_INSECURE_DATABASE_TLS),
    allowedOrigins: [config.TOOLFLOW_ADMIN_ORIGIN],
    objects: createConfiguredObjectStore({ filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH), environment, production: config.NODE_ENV === "production" }),
    rateLimiter: new PostgresRateLimiter(database.pool),
    ...(authKit ? { authKit } : {}),
    ...(invitationSender ? { invitationSender } : {}),
  });
  return { app, close: () => database.close() };
}
