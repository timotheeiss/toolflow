import { timingSafeEqual } from "node:crypto";
import { BuildWorker } from "@toolflow/build-system";
import type { ToolflowDatabase } from "@toolflow/database";
import type { ImmutableObjectStore } from "@toolflow/object-store";

export function createBuildRunner(
  database: ToolflowDatabase["db"],
  objects: ImmutableObjectStore,
  token: string,
  options: { timeoutMs: number; maximumArtifactBytes: number },
) : { fetch(request: Request): Promise<Response> } {
  const worker = new BuildWorker(database, objects, options);
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" });
      const match = request.method === "POST" && url.pathname.match(/^\/v1\/builds\/([0-9a-f-]{36})$/);
      if (!match) return Response.json({ message: "Not found." }, { status: 404 });
      const value = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!constantEqual(value, token)) return Response.json({ message: "Access denied." }, { status: 401 });
      const handled = await worker.run(match[1]!);
      return Response.json({ handled });
    },
  };
}

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
