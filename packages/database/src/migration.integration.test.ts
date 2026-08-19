import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRateLimiter } from "./rate-limit.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migration integration tests.");

const client = new Client({ connectionString });
const rateLimitPool = new Pool({ connectionString, max: 4 });

describe("initial control-plane migration", () => {
  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await rateLimitPool.end();
  });

  it("creates all control-plane tables and tenant indexes", async () => {
    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "organizations",
        "organization_memberships",
        "apps",
        "app_routes",
        "source_versions",
        "builds",
        "deployments",
        "rate_limit_buckets",
        "audit_events",
      ]),
    );

    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain("apps_organization_slug_unique");
    expect(indexes.rows.map((row) => row.indexname)).toContain("app_routes_app_environment_unique");
    expect(indexes.rows.map((row) => row.indexname)).toContain("audit_organization_occurred_idx");
    expect(indexes.rows.map((row) => row.indexname)).toContain("rate_limit_buckets_reset_idx");

    expect(tables.rows.map((row) => row.table_name)).not.toContain("approval_requests");
    expect(tables.rows.map((row) => row.table_name)).not.toContain("approval_decisions");
    const deploymentColumns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'deployments'",
    );
    expect(deploymentColumns.rows.map((row) => row.column_name)).not.toContain(
      "approval_request_id",
    );
    const urlColumns = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'app_routes' and column_name = 'url') or (table_name = 'apps' and column_name in ('preview_url', 'production_url'))) order by table_name, column_name",
    );
    expect(urlColumns.rows).toEqual([{ table_name: "app_routes", column_name: "url" }]);
  });

  it("atomically shares hashed rate-limit buckets across service instances", async () => {
    const scope = `integration-${randomUUID()}`;
    const key = `organization:${randomUUID()}:actor:${randomUUID()}`;
    const first = new PostgresRateLimiter(rateLimitPool);
    const second = new PostgresRateLimiter(rateLimitPool);
    try {
      const decisions = await Promise.all(
        Array.from({ length: 25 }, (_, index) =>
          (index % 2 === 0 ? first : second).consume(scope, key, {
            limit: 10,
            windowMs: 60_000,
          }),
        ),
      );
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
      const stored = await client.query<{ count: number; key_hash: string }>(
        "select count, key_hash from rate_limit_buckets where scope = $1",
        [scope],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({ count: 25 });
      expect(stored.rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0]?.key_hash).not.toContain(key);
    } finally {
      await client.query("delete from rate_limit_buckets where scope = $1", [scope]);
    }
  });

  it("backfills one trusted preview and production route for every app", async () => {
    const coverage = await client.query<{ missing: string }>(`
      select count(*)::text as missing
      from apps
      where not exists (
        select 1 from app_routes
        where app_routes.app_id = apps.id and app_routes.environment = 'preview'
      ) or not exists (
        select 1 from app_routes
        where app_routes.app_id = apps.id and app_routes.environment = 'production'
      )
    `);
    expect(coverage.rows[0]?.missing).toBe("0");
  });

  it("permits invited users without an external identity", async () => {
    await client.query("begin");
    try {
      const userId = randomUUID();
      await client.query("insert into users (id, email, name) values ($1, $2, $3)", [
        userId,
        `${userId}@example.com`,
        "Invited User",
      ]);
      const result = await client.query<{ external_identity_id: string | null }>(
        "select external_identity_id from users where id = $1",
        [userId],
      );
      expect(result.rows[0]?.external_identity_id).toBeNull();
    } finally {
      await client.query("rollback");
    }
  });

  it("enforces append-only audit events at the database boundary", async () => {
    await client.query("begin");
    try {
      const organizationId = randomUUID();
      const actorId = randomUUID();
      const eventId = randomUUID();
      await client.query(
        "insert into organizations (id, external_identity_id, slug, name) values ($1, $2, $3, $4)",
        [organizationId, `external-${organizationId}`, `org-${organizationId}`, "Audit Test"],
      );
      await client.query(
        "insert into audit_events (id, organization_id, actor_type, actor_id, action, target_type, target_id, request_id, outcome) values ($1::uuid, $2::uuid, 'user', $3::uuid, 'test', 'organization', $2::uuid::text, $4, 'succeeded')",
        [eventId, organizationId, actorId, randomUUID()],
      );

      await expect(
        client.query("update audit_events set action = 'tampered' where id = $1", [eventId]),
      ).rejects.toThrow("audit_events are append-only");
    } finally {
      await client.query("rollback");
    }
  });
});
