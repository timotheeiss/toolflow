import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkOS } from "@workos-inc/node";
import { DatabaseAuditWriter } from "@toolflow/audit";
import { BearerRequestAuthenticator, CompositeRequestAuthenticator, JwksAccessTokenVerifier, WorkOsSessionAuthenticator, type RequestAuthenticator } from "@toolflow/auth";
import { createDatabase } from "@toolflow/database";
import { createConfiguredObjectStore } from "@toolflow/object-store";
import { RuntimeContextSigner } from "@toolflow/runtime-context";
import { createRuntimeDispatcher } from "./app.js";
import { DevelopmentRuntimeAuthenticator } from "./auth.js";
import { parseConfig } from "./config.js";
import { DatabaseMembershipIdentityRepository } from "./membership-repository.js";

export function createRuntimeDispatcherApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const database = createDatabase(config.DATABASE_URL);
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  let authenticator: RequestAuthenticator;
  if (config.TOOLFLOW_AUTH_MODE === "development") {
    authenticator = new DevelopmentRuntimeAuthenticator(database.db, { userId: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", organizationId: "00000000-0000-4000-8000-000000000003", role: "admin", sessionId: "development-runtime-session" });
  } else {
    const memberships = new DatabaseMembershipIdentityRepository(database.db);
    const workos = new WorkOS({ apiKey: config.WORKOS_API_KEY!, clientId: config.WORKOS_CLIENT_ID! });
    authenticator = new CompositeRequestAuthenticator([
      new WorkOsSessionAuthenticator(workos, memberships, config.WORKOS_COOKIE_PASSWORD!, { secure: config.NODE_ENV === "production", ...(config.TOOLFLOW_COOKIE_DOMAIN ? { domain: config.TOOLFLOW_COOKIE_DOMAIN } : {}) }),
      new BearerRequestAuthenticator(new JwksAccessTokenVerifier({ issuer: config.WORKOS_ISSUER!, audience: config.WORKOS_AUDIENCE!, jwksUrl: config.WORKOS_JWKS_URL! }), memberships),
    ]);
  }
  const app = createRuntimeDispatcher({
    database: database.db,
    objects: createConfiguredObjectStore({ filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH), environment, production: config.NODE_ENV === "production" }),
    authenticator, audit: new DatabaseAuditWriter(database.db),
    runtimeContextSigner: new RuntimeContextSigner(Buffer.from(config.TOOLFLOW_RUNTIME_CONTEXT_SECRET, "base64")),
    dataGatewayUrl: config.TOOLFLOW_DATA_GATEWAY_URL,
    ...(config.TOOLFLOW_RUNTIME_AUTHORIZATION_SERVICE_TOKEN ? { authorizationServiceToken: config.TOOLFLOW_RUNTIME_AUTHORIZATION_SERVICE_TOKEN } : {}),
  });
  return { app, close: () => database.close() };
}
