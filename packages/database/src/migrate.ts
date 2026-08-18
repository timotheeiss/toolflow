import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const database = createDatabase(connectionString);

try {
  await migrate(database.db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
} finally {
  await database.close();
}
