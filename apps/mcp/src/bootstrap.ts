import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseAuditWriter } from "@toolflow/audit";
import { JwksAccessTokenVerifier, type AccessTokenVerifier } from "@toolflow/auth";
import { createDatabase, PostgresRateLimiter } from "@toolflow/database";
import { createConfiguredObjectStore } from "@toolflow/object-store";
import { HttpRuntimePublisher } from "@toolflow/lifecycle";
import { createMcpApp } from "./app.js";
import { parseConfig } from "./config.js";
import { DatabaseMembershipIdentityRepository } from "./membership-repository.js";
import { DevelopmentAccessTokenVerifier, ToolflowOAuthTokenVerifier } from "./oauth-verifier.js";

export function createMcpApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const database = createDatabase(config.DATABASE_URL);
  const resourceUrl = new URL(config.TOOLFLOW_MCP_RESOURCE_URL);
  const memberships = new DatabaseMembershipIdentityRepository(database.db);
  let accessTokenVerifier: AccessTokenVerifier;
  if (config.TOOLFLOW_AUTH_MODE === "development") accessTokenVerifier = new DevelopmentAccessTokenVerifier();
  else accessTokenVerifier = new JwksAccessTokenVerifier({ issuer: config.WORKOS_ISSUER, audience: config.WORKOS_AUDIENCE, jwksUrl: config.WORKOS_JWKS_URL! });
  const app = createMcpApp({
    database: database.db, pool: database.pool,
    objects: createConfiguredObjectStore({ filesystemRoot: resolve(workspaceRoot, config.TOOLFLOW_OBJECT_STORE_PATH), environment, production: config.NODE_ENV === "production" }),
    audit: new DatabaseAuditWriter(database.db), verifier: new ToolflowOAuthTokenVerifier(accessTokenVerifier, memberships, resourceUrl),
    resourceUrl, issuer: config.WORKOS_ISSUER, authorizationEndpoint: config.WORKOS_AUTHORIZATION_ENDPOINT, tokenEndpoint: config.WORKOS_TOKEN_ENDPOINT,
    ...(config.WORKOS_REGISTRATION_ENDPOINT ? { registrationEndpoint: config.WORKOS_REGISTRATION_ENDPOINT } : {}),
    allowedHosts: config.allowedHosts, allowedOrigins: config.allowedOrigins, allowInsecureIssuer: config.NODE_ENV !== "production",
    runtimeBaseUrl: config.TOOLFLOW_RUNTIME_BASE_URL, buildExecution: config.TOOLFLOW_BUILD_EXECUTION,
    ...(config.TOOLFLOW_BUILD_SERVICE_URL && config.TOOLFLOW_BUILD_SERVICE_TOKEN ? { buildRunner: { url: config.TOOLFLOW_BUILD_SERVICE_URL, token: config.TOOLFLOW_BUILD_SERVICE_TOKEN } } : {}),
    rateLimiter: new PostgresRateLimiter(database.pool),
    ...(config.TOOLFLOW_DEPLOYMENT_SERVICE_URL && config.TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN ? { runtimePublisher: new HttpRuntimePublisher(config.TOOLFLOW_DEPLOYMENT_SERVICE_URL, config.TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN) } : {}),
  });
  return { app, close: async () => { await app.close(); await database.close(); } };
}
