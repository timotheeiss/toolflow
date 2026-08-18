import { describe, expect, it } from "vitest";
import { redact } from "./redaction.js";

describe("redact", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redact({
        email: "person@example.com",
        authorization: "Bearer unsafe",
        nested: { apiKey: "unsafe", count: 2 },
      }),
    ).toEqual({
      email: "person@example.com",
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", count: 2 },
    });
  });

  it("handles cyclic values without throwing", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(redact(value)).toEqual({ self: "[CIRCULAR]" });
  });
});
