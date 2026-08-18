import { describe, expect, it } from "vitest";
import { appManifestSchema, capabilityKey } from "./manifest.js";

describe("appManifestSchema", () => {
  it("accepts the fixed MVP runtime and an external read capability", () => {
    const manifest = appManifestSchema.parse({
      manifestVersion: 1,
      name: "Refund approval",
      runtime: "toolflow-react-v1",
      capabilities: [
        {
          kind: "external_postgres",
          connection: "warehouse",
          schema: "public",
          table: "accounts",
          operations: ["read"],
        },
      ],
      schema: { tables: [] },
      routes: [{ path: "/" }],
      healthcheck: "/api/health",
    });

    expect(capabilityKey(manifest.capabilities[0]!)).toBe(
      "external_postgres:warehouse:public:accounts:read",
    );
  });

  it("rejects external write operations", () => {
    expect(() =>
      appManifestSchema.parse({
        manifestVersion: 1,
        name: "Unsafe app",
        runtime: "toolflow-react-v1",
        capabilities: [
          {
            kind: "external_postgres",
            connection: "warehouse",
            schema: "public",
            table: "accounts",
            operations: ["update"],
          },
        ],
        routes: [{ path: "/" }],
        healthcheck: "/api/health",
      }),
    ).toThrow();
  });
});
