import pg from "pg";
import { loadEnv } from "./env";

loadEnv();

/** Drops and recreates the application schemas. Refuses to run in production. */
export async function resetDatabase(url = process.env.DATABASE_OWNER_URL) {
  if (process.env.APP_ENV === "production") throw new Error("refusing to reset a production database");
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then(() => console.log("database reset"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
