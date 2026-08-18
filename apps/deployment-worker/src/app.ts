import { createHash, timingSafeEqual } from "node:crypto";
import type { ToolflowArtifact } from "@toolflow/build-system";
import { appManifestSchema } from "@toolflow/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { DeploymentProvider } from "./provider.js";

const publishInput = z.object({
  deploymentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  appId: z.string().uuid(),
  appSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  environment: z.enum(["preview", "production"]),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifact: z.object({
    version: z.literal(1),
    sourceHash: z.string(),
    runtimeVersion: z.string(),
    manifest: appManifestSchema,
    html: z.string().min(1),
    clientJavaScript: z.string().min(1),
    clientCss: z.string(),
    serverJavaScript: z.string().min(1),
  }),
});

export function createDeploymentWorker(provider: DeploymentProvider, serviceToken: string) {
  const app = new Hono();
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.use("/v1/*", async (context, next) => {
    const token = bearerToken(context.req.header("authorization"));
    if (!token || !constantEqual(token, serviceToken)) {
      return context.json({ code: "AUTHENTICATION_REQUIRED", message: "Access denied." }, 401);
    }
    await next();
  });
  app.post("/v1/publish", async (context) => {
    const raw = await context.req.text();
    if (Buffer.byteLength(raw) > 8_000_000) {
      return context.json({ code: "PAYLOAD_TOO_LARGE", message: "Artifact exceeds 8 MB." }, 413);
    }
    const input = publishInput.parse(JSON.parse(raw));
    const artifact: ToolflowArtifact = input.artifact;
    const calculatedHash = createHash("sha256").update(stableJson(artifact)).digest("hex");
    if (calculatedHash !== input.artifactHash) {
      return context.json(
        { code: "ARTIFACT_HASH_MISMATCH", message: "Artifact hash mismatch." },
        422,
      );
    }
    const result = await provider.publish({
      deploymentId: input.deploymentId,
      environment: input.environment,
      artifactHash: input.artifactHash,
      artifact,
    });
    return context.json({ ...result, health: "passed" as const });
  });
  app.onError((error, context) =>
    context.json(
      {
        code: error instanceof z.ZodError ? "VALIDATION_FAILED" : "PUBLICATION_FAILED",
        message:
          error instanceof z.ZodError ? "Deployment request is invalid." : "Publication failed.",
      },
      error instanceof z.ZodError ? 422 : 502,
    ),
  );
  return app;
}

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7);
}

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
