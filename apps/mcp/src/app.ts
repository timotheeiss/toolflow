import type { OAuthMetadata, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import type { AuditWriter } from "@toolflow/audit";
import { AppSchemaService } from "@toolflow/app-data";
import { BuildService } from "@toolflow/build-system";
import { InMemoryRateLimiter, type RateLimiter, type ToolflowDatabase } from "@toolflow/database";
import {
  DeploymentService,
  ProductionDeploymentService,
  type RuntimePublisher,
} from "@toolflow/lifecycle";
import type { ImmutableObjectStore } from "@toolflow/object-store";
import type { Pool } from "pg";
import { principalFromAuthInfo } from "./oauth-verifier.js";
import { createToolflowMcpServer } from "./server.js";
import { ToolflowSourceService } from "./source-service.js";

export interface McpAppDependencies {
  database: ToolflowDatabase["db"];
  pool: Pool;
  objects: ImmutableObjectStore;
  audit: AuditWriter;
  verifier: OAuthTokenVerifier;
  resourceUrl: URL;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowInsecureIssuer: boolean;
  runtimeBaseUrl: string;
  runtimePublisher?: RuntimePublisher;
  buildExecution?: "inline" | "external";
  buildRunner?: { url: string; token: string };
  rateLimiter?: RateLimiter;
}

export function createMcpApp(dependencies: McpAppDependencies) {
  const rateLimiter = dependencies.rateLimiter ?? new InMemoryRateLimiter();
  const service = new ToolflowSourceService(
    dependencies.database,
    dependencies.objects,
    dependencies.runtimeBaseUrl,
  );
  const buildService = new BuildService(dependencies.database, dependencies.objects, {
    execution: dependencies.buildExecution ?? "inline",
    ...(dependencies.buildRunner ? { runner: dependencies.buildRunner } : {}),
  });
  const deploymentService = new DeploymentService(
    dependencies.database,
    dependencies.objects,
    dependencies.runtimeBaseUrl,
    dependencies.runtimePublisher,
  );
  const schemaService = new AppSchemaService(dependencies.database, dependencies.pool);
  const productionService = new ProductionDeploymentService(
    dependencies.database,
    dependencies.pool,
    dependencies.objects,
    dependencies.runtimeBaseUrl,
    dependencies.runtimePublisher,
  );
  const handler = createMcpHandler(
    (context) =>
      createToolflowMcpServer(principalFromAuthInfo(context.authInfo), {
        service,
        buildService,
        deploymentService,
        schemaService,
        productionService,
        audit: dependencies.audit,
        database: dependencies.database,
      }),
    { responseMode: "auto", legacy: "stateless" },
  );
  const metadata: OAuthMetadata = {
    issuer: dependencies.issuer,
    authorization_endpoint: dependencies.authorizationEndpoint,
    token_endpoint: dependencies.tokenEndpoint,
    ...(dependencies.registrationEndpoint
      ? { registration_endpoint: dependencies.registrationEndpoint }
      : {}),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    scopes_supported: ["toolflow:mcp", "toolflow:read", "toolflow:write", "toolflow:deploy"],
  };
  const metadataOptions = {
    oauthMetadata: metadata,
    resourceServerUrl: dependencies.resourceUrl,
    serviceDocumentationUrl: new URL("https://toolflow.example/docs/mcp"),
    scopesSupported: ["toolflow:mcp", "toolflow:read", "toolflow:write", "toolflow:deploy"],
    resourceName: "Toolflow organization tooling",
    dangerouslyAllowInsecureIssuerUrl: dependencies.allowInsecureIssuer,
  };
  const gate = requireBearerAuth({
    verifier: dependencies.verifier,
    requiredScopes: ["toolflow:mcp"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(dependencies.resourceUrl),
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const hostDenied = hostHeaderValidationResponse(request, dependencies.allowedHosts);
      if (hostDenied) return hostDenied;
      const originDenied = originValidationResponse(request, dependencies.allowedOrigins);
      if (originDenied) return originDenied;
      const discovery = oauthMetadataResponse(request, metadataOptions);
      if (discovery) return discovery;
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", protocol: "MCP", version: "2.0" });
      }
      if (url.pathname !== dependencies.resourceUrl.pathname) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const auth = await gate(request);
      if (!("token" in auth)) return auth;
      const principal = principalFromAuthInfo(auth);
      const rateKey = `${principal.organizationId}:${principal.userId}`;
      const decision = await rateLimiter.consume("mcp-request", rateKey, {
        limit: 600,
        windowMs: 60_000,
      });
      if (!decision.allowed) {
        await dependencies.audit.append({
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
          ...(principal.clientId ? { clientId: principal.clientId } : {}),
          action: "mcp.rate_limited",
          targetType: "mcp_endpoint",
          targetId: dependencies.resourceUrl.pathname,
          requestId: crypto.randomUUID(),
          outcome: "denied",
          metadata: { retryAfterSeconds: decision.retryAfterSeconds },
        });
        return Response.json(
          { code: "RATE_LIMITED", message: "MCP request quota exceeded." },
          {
            status: 429,
            headers: {
              "retry-after": String(decision.retryAfterSeconds),
              "cache-control": "no-store",
            },
          },
        );
      }
      return handler.fetch(request, { authInfo: auth });
    },
    close: () => handler.close(),
  };
}
