import { describe, expect, it } from "vitest";
import { authorizeExternalRead, SqlPolicyError } from "./sql-policy.js";

const grants = [{ schema: "analytics", table: "orders" }];

describe("authorizeExternalRead", () => {
  it("accepts a parameterized read over declared relations", () => {
    expect(
      authorizeExternalRead(
        "select status, count(*) from analytics.orders where created_at >= $1 group by status",
        ["2026-01-01"],
        grants,
      ),
    ).toMatchObject({
      normalizedRelations: ["analytics.orders"],
      functions: ["count"],
      parameterCount: 1,
    });
  });

  it.each([
    "update analytics.orders set status = 'closed'",
    "delete from analytics.orders",
    "insert into analytics.orders(id) values (1)",
    "create table analytics.nope(id int)",
    "copy analytics.orders to stdout",
  ])("rejects write or administrative SQL: %s", (sql) => {
    expect(() => authorizeExternalRead(sql, [], grants)).toThrow(SqlPolicyError);
  });

  it("rejects multiple statements and undeclared relations", () => {
    expect(() => authorizeExternalRead("select 1; select 2", [], grants)).toThrow(
      "Exactly one SQL statement",
    );
    expect(() => authorizeExternalRead("select * from public.users", [], grants)).toThrow(
      "undeclared relation public.users",
    );
  });

  it("rejects system catalogs and non-allowlisted functions", () => {
    expect(() => authorizeExternalRead("select * from pg_catalog.pg_roles", [], grants)).toThrow(
      "system catalogs",
    );
    expect(() =>
      authorizeExternalRead("select pg_sleep(1) from analytics.orders", [], grants),
    ).toThrow("not on Toolflow's read-only allowlist");
  });

  it("requires placeholders to match the parameter array", () => {
    expect(() =>
      authorizeExternalRead("select * from analytics.orders where id = $1", [], grants),
    ).toThrow("do not match");
  });
});
