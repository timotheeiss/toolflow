export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface DispatchNamespace {
  get(
    scriptName: string,
    bindings?: Record<string, unknown>,
    options?: {
      limits?: { cpuMs?: number; subRequests?: number };
      outbound?: Record<string, unknown>;
    },
  ): ServiceBinding;
}

export interface DispatchEnvironment {
  TOOLFLOW_USER_WORKERS: DispatchNamespace;
  TOOLFLOW_RUNTIME_RATE_LIMITER: RateLimitBinding;
  TOOLFLOW_PLATFORM_FETCH?: ServiceBinding;
  TOOLFLOW_AUTHORIZATION_ORIGIN: string;
  TOOLFLOW_AUTHORIZATION_SERVICE_TOKEN: string;
  TOOLFLOW_HEALTH_SERVICE_TOKEN?: string;
  TOOLFLOW_DATA_GATEWAY_ORIGIN: string;
  TOOLFLOW_APP_BASE_HOST: string;
  TOOLFLOW_RUNTIME_CPU_MS?: string;
  TOOLFLOW_RUNTIME_SUBREQUESTS?: string;
  TOOLFLOW_RUNTIME_MAX_RESPONSE_BYTES?: string;
  TOOLFLOW_RUNTIME_MAX_DURATION_MS?: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface AuthorizationGrant {
  allowed: true;
  routeKey: string;
  scriptName: string;
  organizationId: string;
  appId: string;
  deploymentId: string;
  environment: "preview" | "production";
  requestId: string;
  traceId: string;
  actorHash: string;
  runtimeContextToken: string;
  publicContext: {
    userId: string;
    name: string;
    email: string;
    appId: string;
    environment: "preview" | "production";
    dataPath: string;
  };
}

const scriptNamePattern =
  /^tf-(preview|production)-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const routeKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const dataPaths = new Map([
  ["external-query", "/v1/external-query"],
  ["managed/create", "/v1/managed/create"],
  ["managed/list", "/v1/managed/list"],
  ["managed/update", "/v1/managed/update"],
  ["managed/delete", "/v1/managed/delete"],
]);

export async function handleDispatchRequest(
  request: Request,
  environment: DispatchEnvironment,
  context: ExecutionContextLike,
): Promise<Response> {
  const started = Date.now();
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/internal/health") {
    return internalHealth(request, environment);
  }
  if (
    !secureOrigin(environment.TOOLFLOW_AUTHORIZATION_ORIGIN) ||
    !secureOrigin(environment.TOOLFLOW_DATA_GATEWAY_ORIGIN) ||
    !validBaseHost(environment.TOOLFLOW_APP_BASE_HOST) ||
    !environment.TOOLFLOW_RUNTIME_RATE_LIMITER ||
    environment.TOOLFLOW_AUTHORIZATION_SERVICE_TOKEN.length < 32
  ) {
    return Response.json(
      { code: "DEPENDENCY_FAILED", message: "Runtime platform configuration is invalid." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const routeKey = routeKeyFromHostname(requestUrl.hostname, environment.TOOLFLOW_APP_BASE_HOST);
  if (!routeKey) return notFound();
  const nestedPath = requestUrl.pathname.replace(/^\/+/, "");
  const authorization = await authorize(request, environment, routeKey);
  if (!authorization) return notFound();
  const limits = runtimeLimits(environment);

  let response: Response;
  try {
    const rateLimit = await environment.TOOLFLOW_RUNTIME_RATE_LIMITER.limit({
      key: `${authorization.organizationId}:${authorization.actorHash}`,
    });
    if (!rateLimit.success) {
      response = Response.json(
        { code: "RATE_LIMITED", message: "Runtime request quota exceeded." },
        {
          status: 429,
          headers: { "cache-control": "no-store", "retry-after": "60" },
        },
      );
    } else {
      const gatewayPath = nestedPath.startsWith("__toolflow/data/")
        ? dataPaths.get(nestedPath.slice("__toolflow/data/".length))
        : undefined;
      response = gatewayPath
        ? await forwardDataRequest(request, gatewayPath, authorization, environment)
        : await dispatchUserWorker(request, authorization, environment, limits);
    }
  } catch {
    response = Response.json(
      { code: "DEPENDENCY_FAILED", message: "Runtime request quota is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  response.headers.set("x-request-id", authorization.requestId);
  response.headers.set("x-trace-id", authorization.traceId);
  response.headers.set("x-content-type-options", "nosniff");

  context.waitUntil(
    platformFetch(
      environment,
      new Request(new URL("/internal/runtime-usage", environment.TOOLFLOW_AUTHORIZATION_ORIGIN), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-toolflow-service-authorization": environment.TOOLFLOW_AUTHORIZATION_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          organizationId: authorization.organizationId,
          appId: authorization.appId,
          deploymentId: authorization.deploymentId,
          environment: authorization.environment,
          requestId: authorization.requestId,
          traceId: authorization.traceId,
          actorHash: authorization.actorHash,
          status: response.status,
          durationMs: Date.now() - started,
        }),
      }),
    ),
  );
  return response;
}

async function internalHealth(
  request: Request,
  environment: DispatchEnvironment,
): Promise<Response> {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? "";
  if (
    request.method !== "POST" ||
    !environment.TOOLFLOW_HEALTH_SERVICE_TOKEN ||
    supplied !== environment.TOOLFLOW_HEALTH_SERVICE_TOKEN
  ) {
    return new Response(null, { status: 404 });
  }
  const raw = await request.text();
  if (raw.length > 2_048) return new Response(null, { status: 413 });
  let scriptName: string;
  try {
    const value = JSON.parse(raw) as { scriptName?: unknown };
    if (typeof value.scriptName !== "string" || !scriptNamePattern.test(value.scriptName)) {
      return new Response(null, { status: 422 });
    }
    scriptName = value.scriptName;
  } catch {
    return new Response(null, { status: 422 });
  }
  try {
    const worker = environment.TOOLFLOW_USER_WORKERS.get(
      scriptName,
      {},
      {
        limits: { cpuMs: 50, subRequests: 1 },
      },
    );
    const response = await worker.fetch(
      new Request("https://toolflow.internal/api/health", {
        headers: { "x-toolflow-health-probe": "true" },
      }),
    );
    const body = await response.text();
    if (!response.ok) {
      return healthFailure(
        scriptName,
        "APP_HEALTH_HTTP_FAILED",
        `Deployed app health endpoint returned status ${response.status}.`,
      );
    }
    if (body.length > 2_048) {
      return healthFailure(
        scriptName,
        "APP_HEALTH_RESPONSE_TOO_LARGE",
        "Deployed app health response exceeded the platform limit.",
      );
    }
    let result: { status?: unknown };
    try {
      result = JSON.parse(body) as { status?: unknown };
    } catch (error) {
      return healthFailure(
        scriptName,
        "APP_HEALTH_RESPONSE_INVALID",
        "Deployed app health response was not valid JSON.",
        error,
      );
    }
    if (result.status !== "ok") {
      return healthFailure(
        scriptName,
        "APP_HEALTH_RESPONSE_INVALID",
        "Deployed app health response did not report an ok status.",
      );
    }
    return Response.json({ health: "passed", scriptName });
  } catch (error) {
    const workerMissing =
      error instanceof Error && error.message.toLowerCase().includes("worker not found");
    return healthFailure(
      scriptName,
      workerMissing ? "USER_WORKER_NOT_FOUND" : "USER_WORKER_INVOCATION_FAILED",
      workerMissing
        ? "Uploaded Worker is not available in the configured dispatch namespace."
        : "Uploaded Worker could not be invoked for its health check.",
      error,
    );
  }
}

function healthFailure(
  scriptName: string,
  code: string,
  message: string,
  cause?: unknown,
): Response {
  console.error("User Worker health probe failed.", { code, scriptName, cause });
  return Response.json(
    { code, message },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

async function authorize(
  request: Request,
  environment: DispatchEnvironment,
  routeKey: string,
): Promise<AuthorizationGrant | null> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-toolflow-route-key": routeKey,
  });
  for (const name of ["authorization", "cookie", "user-agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-toolflow-service-authorization", environment.TOOLFLOW_AUTHORIZATION_SERVICE_TOKEN);
  const response = await platformFetch(
    environment,
    new Request(new URL("/internal/authorize-runtime", environment.TOOLFLOW_AUTHORIZATION_ORIGIN), {
      method: "POST",
      headers,
      redirect: "manual",
    }),
  );
  if (!response.ok) return null;
  const raw = await response.text();
  if (raw.length > 16_384) return null;
  try {
    const value = JSON.parse(raw) as Partial<AuthorizationGrant>;
    if (
      value.allowed !== true ||
      value.routeKey !== routeKey ||
      typeof value.scriptName !== "string" ||
      !scriptNamePattern.test(value.scriptName) ||
      typeof value.organizationId !== "string" ||
      typeof value.appId !== "string" ||
      typeof value.deploymentId !== "string" ||
      (value.environment !== "preview" && value.environment !== "production") ||
      typeof value.requestId !== "string" ||
      typeof value.traceId !== "string" ||
      !/^[0-9a-f]{32}$/.test(value.traceId) ||
      typeof value.actorHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.actorHash) ||
      typeof value.runtimeContextToken !== "string" ||
      value.runtimeContextToken.length < 32 ||
      !value.publicContext
    ) {
      return null;
    }
    return value as AuthorizationGrant;
  } catch {
    return null;
  }
}

async function forwardDataRequest(
  request: Request,
  gatewayPath: string,
  authorization: AuthorizationGrant,
  environment: DispatchEnvironment,
): Promise<Response> {
  if (request.method !== "POST") return notFound();
  const body = await request.arrayBuffer();
  if (body.byteLength > 1_000_000) {
    return Response.json(
      { code: "PAYLOAD_TOO_LARGE", message: "Request exceeds 1 MB." },
      { status: 413 },
    );
  }
  const upstream = await platformFetch(
    environment,
    new Request(new URL(gatewayPath, environment.TOOLFLOW_DATA_GATEWAY_ORIGIN), {
      method: "POST",
      headers: {
        authorization: `Bearer ${authorization.runtimeContextToken}`,
        "content-type": "application/json",
        "x-request-id": authorization.requestId,
        "x-trace-id": authorization.traceId,
      },
      body,
      redirect: "manual",
    }),
  );
  if (upstream.status >= 300 && upstream.status < 400) {
    return Response.json(
      { code: "DEPENDENCY_FAILED", message: "Data gateway redirect was rejected." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

async function dispatchUserWorker(
  request: Request,
  authorization: AuthorizationGrant,
  environment: DispatchEnvironment,
  limits: RuntimeLimits,
): Promise<Response> {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-toolflow-")) headers.delete(name);
  }
  headers.set(
    "x-toolflow-public-context",
    encodeURIComponent(JSON.stringify(authorization.publicContext)),
  );
  const userWorker = environment.TOOLFLOW_USER_WORKERS.get(
    authorization.scriptName,
    {},
    {
      limits: { cpuMs: limits.cpuMs, subRequests: limits.subRequests },
      outbound: {
        TOOLFLOW_DATA_GATEWAY_ORIGIN: environment.TOOLFLOW_DATA_GATEWAY_ORIGIN,
        TOOLFLOW_RUNTIME_CONTEXT_TOKEN: authorization.runtimeContextToken,
        TOOLFLOW_DISPATCH_CONTEXT: JSON.stringify({
          organizationId: authorization.organizationId,
          appId: authorization.appId,
          deploymentId: authorization.deploymentId,
          environment: authorization.environment,
          requestId: authorization.requestId,
          traceId: authorization.traceId,
        }),
      },
    },
  );
  try {
    const response = await withDeadline(
      userWorker.fetch(new Request(request, { headers })),
      limits.maximumDurationMs,
    );
    return boundResponse(response, limits.maximumResponseBytes);
  } catch {
    return Response.json(
      { code: "APP_UNAVAILABLE", message: "The app is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

function notFound(): Response {
  return Response.json(
    { code: "NOT_FOUND", message: "App not found." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function platformFetch(environment: DispatchEnvironment, request: Request): Promise<Response> {
  return environment.TOOLFLOW_PLATFORM_FETCH
    ? environment.TOOLFLOW_PLATFORM_FETCH.fetch(request)
    : fetch(request);
}

function secureOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function validBaseHost(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(
    value.toLowerCase(),
  );
}

function routeKeyFromHostname(hostname: string, baseHost: string): string | null {
  const normalizedHost = hostname.toLowerCase();
  const normalizedBase = baseHost.toLowerCase();
  const suffix = `.${normalizedBase}`;
  if (!normalizedHost.endsWith(suffix)) return null;
  const routeKey = normalizedHost.slice(0, -suffix.length);
  return routeKeyPattern.test(routeKey) ? routeKey : null;
}

interface RuntimeLimits {
  cpuMs: number;
  subRequests: number;
  maximumResponseBytes: number;
  maximumDurationMs: number;
}

function runtimeLimits(environment: DispatchEnvironment): RuntimeLimits {
  return {
    cpuMs: boundedInteger(environment.TOOLFLOW_RUNTIME_CPU_MS, 50, 10, 100),
    subRequests: boundedInteger(environment.TOOLFLOW_RUNTIME_SUBREQUESTS, 10, 1, 50),
    maximumResponseBytes: boundedInteger(
      environment.TOOLFLOW_RUNTIME_MAX_RESPONSE_BYTES,
      8 * 1024 * 1024,
      1_024,
      16 * 1024 * 1024,
    ),
    maximumDurationMs: boundedInteger(
      environment.TOOLFLOW_RUNTIME_MAX_DURATION_MS,
      30_000,
      100,
      60_000,
    ),
  };
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function withDeadline(promise: Promise<Response>, milliseconds: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Response>((resolve) => {
        timer = setTimeout(
          () => resolve(limitResponse("APP_TIMEOUT", "The app request exceeded its time limit.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boundResponse(response: Response, maximumBytes: number): Promise<Response> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel();
    return limitResponse("APP_RESPONSE_TOO_LARGE", "The app response exceeded its size limit.");
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      return limitResponse("APP_RESPONSE_TOO_LARGE", "The app response exceeded its size limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function limitResponse(code: string, message: string): Response {
  return Response.json(
    { code, message },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

export default { fetch: handleDispatchRequest };
