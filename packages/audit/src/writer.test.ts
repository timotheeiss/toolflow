import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryAuditWriter } from "./writer.js";

describe("InMemoryAuditWriter", () => {
  it("validates and redacts audit metadata", async () => {
    const writer = new InMemoryAuditWriter();
    await writer.append({
      organizationId: randomUUID(),
      actorType: "user",
      actorId: randomUUID(),
      action: "app.created",
      targetType: "app",
      targetId: randomUUID(),
      requestId: randomUUID(),
      outcome: "succeeded",
      metadata: { apiKey: "unsafe", name: "Refunds" },
    });

    expect(writer.events[0]?.metadata).toEqual({ apiKey: "[REDACTED]", name: "Refunds" });
  });
});
