import type { AppManifest } from "@toolflow/contracts";
import { describe, expect, it } from "vitest";
import { planAdditiveSchema } from "./planner.js";

type AppSchema = AppManifest["schema"];
const base: AppSchema = {
  tables: [
    {
      name: "requests",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "title", type: "text", nullable: false },
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
    },
  ],
};

describe("planAdditiveSchema", () => {
  it("plans new tables and additive nullable columns", () => {
    expect(planAdditiveSchema(null, base)).toHaveLength(1);
    const target = structuredClone(base);
    target.tables[0]!.columns.push({ name: "notes", type: "text", nullable: true });
    expect(planAdditiveSchema(base, target)).toEqual([
      {
        kind: "add_column",
        table: "requests",
        column: { name: "notes", type: "text", nullable: true },
      },
    ]);
  });

  it("rejects drops, type changes, and unsafe required columns", () => {
    expect(() => planAdditiveSchema(base, { tables: [] })).toThrow("was removed");
    const changed = structuredClone(base);
    changed.tables[0]!.columns[1]!.type = "integer";
    expect(() => planAdditiveSchema(base, changed)).toThrow("changed type");
    const required = structuredClone(base);
    required.tables[0]!.columns.push({ name: "owner", type: "text", nullable: false });
    expect(() => planAdditiveSchema(base, required)).toThrow("nullable or have a default");
  });

  it("rejects invalid references before producing DDL", () => {
    const invalid = structuredClone(base);
    invalid.tables[0]!.indexes.push(["missing"]);
    expect(() => planAdditiveSchema(null, invalid)).toThrow("not a declared index column");
  });
});
