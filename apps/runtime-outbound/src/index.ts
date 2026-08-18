export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface OutboundEnvironment {
  TOOLFLOW_DATA_GATEWAY_ORIGIN: string;
  TOOLFLOW_RUNTIME_CONTEXT_TOKEN: string;
  TOOLFLOW_DISPATCH_CONTEXT: string;
  TOOLFLOW_SECURITY_AUDIT?: ServiceBinding;
  TOOLFLOW_ALLOW_INSECURE_LOCALHOST?: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface DispatchContext {
  organizationId: string;
  appId: string;
  deploymentId: string;
  environment: "preview" | "production";
  requestId: string;
  traceId: string;
}

const permittedPaths = new Set([
  "/v1/external-query",
  "/v1/managed/create",
  "/v1/managed/list",
  "/v1/managed/update",
  "/v1/managed/delete",
]);

export async function handleOutboundRequest(
  request: Request,
  environment: OutboundEnvironment,
  context: ExecutionContextLike,
): Promise<Response> {
  let requested: URL;
  let gateway: URL;
  try {
    requested = new URL(request.url);
    gateway = new URL(environment.TOOLFLOW_DATA_GATEWAY_ORIGIN);
  } catch {
    return deny(environment, context, "invalid_url", null);
  }
  const localDevelopment =
    environment.TOOLFLOW_ALLOW_INSECURE_LOCALHOST === "true" &&
    (gateway.hostname === "127.0.0.1" || gateway.hostname === "localhost");
  if (gateway.protocol !== "https:" && !localDevelopment) {
    return deny(environment, context, "insecure_gateway_configuration", requested);
  }
  if (
    requested.protocol !== gateway.protocol ||
    requested.hostname !== gateway.hostname ||
    requested.port !== gateway.port ||
    request.method !== "POST" ||
    !permittedPaths.has(requested.pathname) ||
    requested.username ||
    requested.password
  ) {
    return deny(environment, context, "destination_not_allowed", requested);
  }
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-toolflow-")) headers.delete(name);
  }
  headers.set("authorization", `Bearer ${environment.TOOLFLOW_RUNTIME_CONTEXT_TOKEN}`);
  headers.set("content-type", "application/json");
  const body = await request.arrayBuffer();
  if (body.byteLength > 1_000_000) {
    return deny(environment, context, "request_too_large", requested);
  }
  const response = await fetch(
    new Request(requested, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
    }),
  );
  if (response.status >= 300 && response.status < 400) {
    return deny(environment, context, "redirect_rejected", requested);
  }
  return response;
}

function deny(
  environment: OutboundEnvironment,
  context: ExecutionContextLike,
  reason: string,
  destination: URL | null,
): Response {
  if (environment.TOOLFLOW_SECURITY_AUDIT) {
    const dispatch = parseDispatchContext(environment.TOOLFLOW_DISPATCH_CONTEXT);
    context.waitUntil(
      environment.TOOLFLOW_SECURITY_AUDIT.fetch(
        new Request("https://toolflow.internal/security/egress-denied", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...dispatch,
            reason,
            destinationOrigin: destination?.origin ?? null,
          }),
        }),
      ),
    );
  }
  return Response.json(
    { code: "EGRESS_DENIED", message: "Outbound request is not permitted." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

function parseDispatchContext(value: string): DispatchContext | null {
  try {
    const candidate = JSON.parse(value) as Partial<DispatchContext>;
    if (
      typeof candidate.organizationId !== "string" ||
      typeof candidate.appId !== "string" ||
      typeof candidate.deploymentId !== "string" ||
      (candidate.environment !== "preview" && candidate.environment !== "production") ||
      typeof candidate.requestId !== "string" ||
      typeof candidate.traceId !== "string" ||
      !/^[0-9a-f]{32}$/.test(candidate.traceId)
    ) {
      return null;
    }
    return candidate as DispatchContext;
  } catch {
    return null;
  }
}

export default { fetch: handleOutboundRequest };
