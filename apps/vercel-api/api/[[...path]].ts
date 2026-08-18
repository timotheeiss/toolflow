import { createControlApiApplication } from "../../control-api/src/bootstrap.js";
import { createDataGatewayApplication } from "../../data-gateway/src/bootstrap.js";
import { createDeploymentApplication } from "../../deployment-worker/src/bootstrap.js";
import { createMcpApplication } from "../../mcp/src/bootstrap.js";
import { createRuntimeDispatcherApplication } from "../../runtime-dispatcher/src/bootstrap.js";

export const maxDuration = 240;

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
  return service ? await service.fetch(request) : new Response("Unknown Toolflow service.", { status: 404 });
}
