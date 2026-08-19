import { createControlApiApplication } from "../../control-api/src/bootstrap.js";
import { createDataGatewayApplication } from "../../data-gateway/src/bootstrap.js";
import { createDeploymentApplication } from "../../deployment-worker/src/bootstrap.js";
import { createMcpApplication } from "../../mcp/src/bootstrap.js";
import { createRuntimeDispatcherApplication } from "../../runtime-dispatcher/src/bootstrap.js";

// Vercel Hobby permits functions to run for at most 60 seconds.
export const maxDuration = 60;

type FetchService = { fetch(request: Request): Response | Promise<Response> };

const serviceFactories = {
  "api.toolflow.space": () => createControlApiApplication().app,
  "mcp.toolflow.space": () => createMcpApplication().app,
  "runtime-auth.toolflow.space": () => createRuntimeDispatcherApplication().app,
  "data.toolflow.space": () => createDataGatewayApplication().app,
  "deploy.toolflow.space": () => createDeploymentApplication(),
} as const;

const services = new Map<string, FetchService>();

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || origin !== process.env.TOOLFLOW_ADMIN_ORIGIN) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

export default async function handler(request: Request): Promise<Response> {
  const host = new URL(request.url).hostname.toLowerCase();
  const factory = serviceFactories[host as keyof typeof serviceFactories];
  if (!factory) return new Response("Unknown Toolflow service.", { status: 404, headers: corsHeaders(request) });

  // The Vercel route passes the public path as an internal query parameter so
  // one concrete function can serve every public API path.
  const url = new URL(request.url);
  const toolflowPath = url.searchParams.get("__toolflow_path");
  if (toolflowPath !== null) {
    url.pathname = `/${toolflowPath}`;
    url.searchParams.delete("__toolflow_path");
  }
  try {
    let service = services.get(host);
    if (!service) {
      const createdService = factory();
      services.set(host, createdService);
      service = createdService;
    }
    return await service.fetch(new Request(url, request));
  } catch (error) {
    console.error(`Failed to initialize ${host}.`, error);
    return new Response("Toolflow service configuration is incomplete.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(request) },
    });
  }
}
