import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { loadEnv } from "./env";

loadEnv();

export async function runMigrations(url = process.env.DATABASE_OWNER_URL) {
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
