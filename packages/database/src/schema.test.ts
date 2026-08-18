import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  apps,
  auditEvents,
  dataConnections,
  deployments,
  organizations,
  sourceVersions,
} from "./schema.js";

describe("control-plane schema", () => {
  it("defines the core tenant, source, and deployment tables", () => {
    expect(
      [organizations, apps, sourceVersions, dataConnections, deployments, auditEvents].map(
        getTableName,
      ),
    ).toEqual([
      "organizations",
      "apps",
      "source_versions",
      "data_connections",
      "deployments",
      "audit_events",
    ]);
  });

  it("requires an organization boundary on every sampled customer-owned table", () => {
    for (const table of [apps, sourceVersions, dataConnections, deployments, auditEvents]) {
      const organizationId = getTableColumns(table).organizationId;
      expect(organizationId, `${getTableName(table)} must have organizationId`).toBeDefined();
      expect(organizationId?.notNull).toBe(true);
    }
  });
});
