import { describe, expect, it } from "vitest";
import { RuntimeContextSigner } from "./index.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  appId: "00000000-0000-4000-8000-000000000002",
  deploymentId: "00000000-0000-4000-8000-000000000003",
  userId: "00000000-0000-4000-8000-000000000004",
  membershipId: "00000000-0000-4000-8000-000000000005",
  environment: "preview" as const,
  requestId: "request-1",
  traceId: "0123456789abcdef0123456789abcdef",
};

describe("RuntimeContextSigner", () => {
  it("round-trips a short-lived bound context", async () => {
    const signer = new RuntimeContextSigner(new Uint8Array(32).fill(1));
    expect(await signer.verify(await signer.sign(context))).toEqual(context);
  });

  it("does not accept a token signed by a different key", async () => {
    const first = new RuntimeContextSigner(new Uint8Array(32).fill(1));
    const second = new RuntimeContextSigner(new Uint8Array(32).fill(2));
    await expect(second.verify(await first.sign(context))).rejects.toThrow();
  });
});
