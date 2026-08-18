import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
  traceId: string;
  startedAt: number;
}

export function createRequestContext(requestId?: string, traceparent?: string): RequestContext {
  return {
    requestId: requestId && requestId.length <= 255 ? requestId : randomUUID(),
    traceId: traceIdFromTraceparent(traceparent) ?? randomUUID().replaceAll("-", ""),
    startedAt: Date.now(),
  };
}

function traceIdFromTraceparent(value: string | undefined): string | null {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(value ?? "");
  return match?.[1] && match[1] !== "00000000000000000000000000000000" ? match[1] : null;
}
