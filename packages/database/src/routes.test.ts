import { describe, expect, it } from "vitest";
import { runtimeAppUrl } from "./routes.js";

const legacy = {
  organizationId: "00000000-0000-4000-8000-000000000003",
  appSlug: "orders",
  environment: "preview" as const,
};

describe("runtime route URLs", () => {
  it("uses a persisted route key on the production wildcard domain", () => {
    expect(
      runtimeAppUrl(
        "https://apps.toolflow.example",
        "00000000-0000-4000-8000-000000000099",
        legacy,
      ),
    ).toBe("https://00000000-0000-4000-8000-000000000099.apps.toolflow.example/");
  });

  it("keeps the authenticated path route for local development", () => {
    expect(
      runtimeAppUrl("http://127.0.0.1:3004", "00000000-0000-4000-8000-000000000099", legacy),
    ).toBe("http://127.0.0.1:3004/apps/00000000-0000-4000-8000-000000000003/orders/preview/");
  });
});
