import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

// Schema changes use the direct URL: PgBouncer's transaction pooler is intended
// for the stateless application connections, not migration jobs.
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL (or DATABASE_URL) is required.");

const database = createDatabase(connectionString);

try {
  await migrate(database.db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
} finally {
  await database.close();
}
