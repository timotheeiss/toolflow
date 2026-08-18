import { describe, expect, it } from "vitest";
import { createRequestContext } from "./request-context.js";

describe("request context", () => {
  it("continues a valid W3C trace and rejects an all-zero trace", () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    expect(createRequestContext("request", `00-${traceId}-0123456789abcdef-01`)).toMatchObject({
      requestId: "request",
      traceId,
    });
    expect(
      createRequestContext(undefined, "00-00000000000000000000000000000000-0123456789abcdef-01")
        .traceId,
    ).toMatch(/^[0-9a-f]{32}$/);
  });
});
