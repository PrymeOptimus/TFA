import { execFileSync } from "node:child_process";

/** Fresh schema + deterministic seed for every test run (crm_test database only). */
export default function setup() {
  const env = {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: "postgres://crm_app:crm_app_local_only@localhost:5432/crm_test",
    DATABASE_OWNER_URL: "postgres://crm_owner:crm_owner_local_only@localhost:5432/crm_test",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
    LOG_LEVEL: "silent",
  };
  for (const script of ["scripts/reset.ts", "scripts/migrate.ts", "scripts/seed.ts"]) {
    execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit" });
  }
}
