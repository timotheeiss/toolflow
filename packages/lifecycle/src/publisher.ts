import type { ToolflowArtifact } from "@toolflow/build-system";

export interface RuntimePublishInput {
  deploymentId: string;
  organizationId: string;
  appId: string;
  appSlug: string;
  environment: "preview" | "production";
  artifactHash: string;
  artifact: ToolflowArtifact;
}

export interface RuntimePublishResult {
  providerDeploymentId: string;
  health: "passed";
}

export interface RuntimePublisher {
  publish(input: RuntimePublishInput): Promise<RuntimePublishResult>;
}

export class LocalRuntimePublisher implements RuntimePublisher {
  publish(input: RuntimePublishInput): Promise<RuntimePublishResult> {
    if (
      !input.artifact.html ||
      !input.artifact.clientJavaScript ||
      !input.artifact.serverJavaScript
    ) {
      return Promise.reject(new Error("Artifact health preflight failed."));
    }
    return Promise.resolve({
      providerDeploymentId: `local:${input.deploymentId}:${input.artifactHash}`,
      health: "passed",
    });
  }
}

export class HttpRuntimePublisher implements RuntimePublisher {
  constructor(
    private readonly serviceUrl: string,
    private readonly serviceToken: string,
  ) {}

  async publish(input: RuntimePublishInput): Promise<RuntimePublishResult> {
    const response = await fetch(new URL("/v1/publish", this.serviceUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.serviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5 * 60 * 1_000),
    });
    const payload = (await response.json()) as Partial<RuntimePublishResult> & { message?: string };
    if (!response.ok || !payload.providerDeploymentId || payload.health !== "passed") {
      throw new Error(payload.message ?? "Runtime publication failed.");
    }
    return { providerDeploymentId: payload.providerDeploymentId, health: payload.health };
  }
}
