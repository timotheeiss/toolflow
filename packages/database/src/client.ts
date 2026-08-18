import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type ToolflowDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string, options: { max?: number } = {}) {
  const pool = new Pool({
    connectionString,
    max: options.max ?? databasePoolMax(),
    application_name: "toolflow-control-plane",
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function databasePoolMax(): number {
  const value = process.env.TOOLFLOW_DATABASE_POOL_MAX;
  if (!value) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("TOOLFLOW_DATABASE_POOL_MAX must be an integer between 1 and 10.");
  }
  return parsed;
}
