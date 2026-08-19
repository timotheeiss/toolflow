import type { IncomingMessage, ServerResponse } from "node:http";
import { handleFetchRequest } from "./_handler.js";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const fetchResponse = await handleFetchRequest(await toFetchRequest(request));
  response.statusCode = fetchResponse.status;

  const setCookies = fetchResponse.headers.getSetCookie();
  for (const [name, value] of fetchResponse.headers) {
    if (name !== "set-cookie") response.setHeader(name, value);
  }
  if (setCookies.length > 0) response.setHeader("set-cookie", setCookies);

  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}

async function toFetchRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const protocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `${protocol}://${host}`);
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const body = await readBody(request);
  return new Request(url, { method, headers, body: new Uint8Array(body) });
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
