import type { ToolflowArtifact } from "@toolflow/build-system";

export interface ProviderPublishInput {
  deploymentId: string;
  environment: "preview" | "production";
  artifactHash: string;
  artifact: ToolflowArtifact;
}

export interface DeploymentProvider {
  publish(input: ProviderPublishInput): Promise<{ providerDeploymentId: string }>;
}

export class DeploymentProviderError extends Error {
  constructor(
    readonly code:
      | "CLOUDFLARE_UPLOAD_FAILED"
      | "CLOUDFLARE_STARTUP_VALIDATION_FAILED"
      | "RUNTIME_HEALTH_REQUEST_FAILED"
      | "RUNTIME_HEALTH_CHECK_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeploymentProviderError";
  }
}

export class LocalDeploymentProvider implements DeploymentProvider {
  publish(input: ProviderPublishInput): Promise<{ providerDeploymentId: string }> {
    return Promise.resolve({
      providerDeploymentId: `deployment-service-local:${input.deploymentId}:${input.artifactHash}`,
    });
  }
}

export class CloudflareDeploymentProvider implements DeploymentProvider {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly namespaces: { preview: string; production: string },
    private readonly healthProbe: { url: string; token: string },
    private readonly apiBaseUrl = "https://api.cloudflare.com/client/v4",
  ) {}

  async publish(input: ProviderPublishInput): Promise<{ providerDeploymentId: string }> {
    const scriptName = `tf-${input.environment}-${input.deploymentId}`;
    const metadata = {
      main_module: "main.js",
      compatibility_date: "2026-08-01",
      bindings: [],
    };
    const body = new FormData();
    body.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    body.set(
      "main.js",
      new Blob([buildUserWorkerModule(input.artifact)], { type: "application/javascript+module" }),
      "main.js",
    );
    body.set(
      "user-server.js",
      new Blob([input.artifact.serverJavaScript], { type: "application/javascript+module" }),
      "user-server.js",
    );
    const namespace = this.namespaces[input.environment];
    let response: Response;
    try {
      response = await fetch(
        `${this.apiBaseUrl}/accounts/${encodeURIComponent(this.accountId)}/workers/dispatch/namespaces/${encodeURIComponent(namespace)}/scripts/${encodeURIComponent(scriptName)}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${this.apiToken}` },
          body,
          signal: AbortSignal.timeout(4 * 60 * 1_000),
        },
      );
    } catch (error) {
      throw new DeploymentProviderError(
        "CLOUDFLARE_UPLOAD_FAILED",
        "Cloudflare publication request failed.",
        { cause: error },
      );
    }
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { id?: string; startup_time_ms?: number };
      errors?: Array<{ code?: number; message?: string }>;
    };
    if (!response.ok || payload.success !== true) {
      const errorCodes = payload.errors
        ?.map((error) => error.code)
        .filter((code): code is number => typeof code === "number");
      const diagnostic = payload.errors
        ?.slice(0, 3)
        .map((error) =>
          `${typeof error.code === "number" ? `[${error.code}] ` : ""}${error.message ?? "Unknown Cloudflare error."}`.slice(
            0,
            1_000,
          ),
        )
        .join("; ");
      throw new DeploymentProviderError(
        "CLOUDFLARE_UPLOAD_FAILED",
        `Cloudflare rejected publication with status ${response.status}${errorCodes?.length ? ` (errors: ${errorCodes.join(", ")})` : ""}.`,
        diagnostic ? { cause: new Error(diagnostic) } : undefined,
      );
    }
    if (typeof payload.result?.startup_time_ms !== "number") {
      throw new DeploymentProviderError(
        "CLOUDFLARE_STARTUP_VALIDATION_FAILED",
        "Cloudflare did not return module startup validation.",
      );
    }
    let health: Response;
    try {
      health = await fetch(this.healthProbe.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.healthProbe.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scriptName,
          deploymentId: input.deploymentId,
          environment: input.environment,
          artifactHash: input.artifactHash,
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new DeploymentProviderError(
        "RUNTIME_HEALTH_REQUEST_FAILED",
        "The runtime health endpoint could not be reached.",
        { cause: error },
      );
    }
    if (!health.ok) {
      const responseText = (await health.text().catch(() => "")).slice(0, 2_048);
      let diagnostic = responseText;
      try {
        const responseBody = JSON.parse(responseText) as { code?: unknown; message?: unknown };
        diagnostic = [responseBody.code, responseBody.message]
          .filter((value): value is string => typeof value === "string")
          .join(": ");
      } catch {
        // Retain the bounded plain-text response for internal diagnostics.
      }
      throw new DeploymentProviderError(
        "RUNTIME_HEALTH_CHECK_FAILED",
        `The deployed Worker health check returned status ${health.status}.`,
        diagnostic ? { cause: new Error(diagnostic) } : undefined,
      );
    }
    const healthResult = (await health.json().catch(() => ({}))) as {
      health?: unknown;
      scriptName?: unknown;
    };
    if (healthResult.health !== "passed" || healthResult.scriptName !== scriptName) {
      throw new DeploymentProviderError(
        "RUNTIME_HEALTH_CHECK_FAILED",
        "The deployed Worker health response was invalid.",
      );
    }
    return { providerDeploymentId: `${namespace}:${payload.result.id ?? scriptName}` };
  }
}

export function buildUserWorkerModule(artifact: ToolflowArtifact): string {
  const html = JSON.stringify(artifact.html);
  const clientJavaScript = JSON.stringify(artifact.clientJavaScript);
  const clientCss = JSON.stringify(artifact.clientCss);
  const healthcheck = JSON.stringify(artifact.manifest.healthcheck);
  return `import userServer from "./user-server.js";
const html=${html};
const clientJavaScript=${clientJavaScript};
const clientCss=${clientCss};
const healthcheck=${healthcheck};
function cleanRequest(request){const headers=new Headers(request.headers);for(const name of [...headers.keys()]){if(name.toLowerCase().startsWith("x-toolflow-"))headers.delete(name);}return new Request(request,{headers});}
function publicContext(request){const encoded=request.headers.get("x-toolflow-public-context");if(!encoded)return null;try{const value=JSON.parse(decodeURIComponent(encoded));if(!value||typeof value.appId!=="string"||typeof value.dataPath!=="string"||(value.environment!=="preview"&&value.environment!=="production"))return null;return value;}catch{return null;}}
function documentResponse(request){const context=publicContext(request);if(!context)return new Response("App context unavailable.",{status:503,headers:{"cache-control":"no-store"}});const nonce=crypto.randomUUID().replaceAll("-","");const safe=JSON.stringify(context).replaceAll("<","\\u003c");const base=context.dataPath.replace(/\\/__toolflow\\/data$/,"/");const banner=context.environment==="preview"?'<div class="tf-preview-banner">Preview environment · isolated test data</div>':"";const document=html.replace("<head>",'<head><base href="'+base+'"><script nonce="'+nonce+'">window.__TOOLFLOW_CONTEXT__='+safe+'</script>').replace("<body>","<body>"+banner);return new Response(document,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; worker-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(request.headers.get("x-toolflow-health-probe")==="true"&&url.pathname===healthcheck)return Response.json({status:"ok"},{headers:{"cache-control":"no-store"}});if(url.pathname.endsWith("/artifact.js"))return new Response(clientJavaScript,{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"private, max-age=31536000, immutable"}});if(url.pathname.endsWith("/artifact.css"))return new Response(clientCss,{headers:{"content-type":"text/css; charset=utf-8","cache-control":"private, max-age=31536000, immutable"}});if(url.pathname.includes("/api/"))return userServer.fetch(cleanRequest(request),env,ctx);return documentResponse(request);}};
`;
}
