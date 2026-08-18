import { createControlApiApplication } from "../../control-api/src/bootstrap.js";
import { createDataGatewayApplication } from "../../data-gateway/src/bootstrap.js";
import { createDeploymentApplication } from "../../deployment-worker/src/bootstrap.js";
import { createMcpApplication } from "../../mcp/src/bootstrap.js";
import { createRuntimeDispatcherApplication } from "../../runtime-dispatcher/src/bootstrap.js";

// Vercel Hobby permits functions to run for at most 60 seconds.
export const maxDuration = 60;

const services = {
  "api.toolflow.space": createControlApiApplication().app,
  "mcp.toolflow.space": createMcpApplication().app,
  "runtime-auth.toolflow.space": createRuntimeDispatcherApplication().app,
  "data.toolflow.space": createDataGatewayApplication().app,
  "deploy.toolflow.space": createDeploymentApplication(),
} as const;

export default async function handler(request: Request): Promise<Response> {
  const host = new URL(request.url).hostname.toLowerCase();
  const service = services[host as keyof typeof services];
  if (!service) return new Response("Unknown Toolflow service.", { status: 404 });

  // Public service URLs do not include Vercel's internal /api route. The rewrite
  // below adds it only to select the function, so remove it before Hono matches
  // the request path.
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);
  return service.fetch(new Request(url, request));
}
