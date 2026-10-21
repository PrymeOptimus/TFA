import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { e2eEnv } from "./env";

/** Creates (if needed), resets, migrates and seeds crm_e2e, then starts a worker process. */
export default async function globalSetup() {
  const admin = new pg.Client({ connectionString: e2eEnv.DATABASE_OWNER_URL!.replace("/crm_e2e", "/postgres") });
  await admin.connect();
  const r = await admin.query("select 1 from pg_database where datname = 'crm_e2e'");
  if (!r.rowCount) await admin.query("create database crm_e2e owner crm_owner");
  await admin.end();
  const env = { ...process.env, ...e2eEnv };
  for (const script of ["scripts/reset.ts", "scripts/migrate.ts", "scripts/seed.ts"]) {
    execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit" });
  }
  const worker = spawn(process.execPath, ["--import", "tsx", "src/worker/main.ts"], { env: { ...env, WORKER_ID: "e2e-worker" }, stdio: "inherit", detached: false });
  writeFileSync(".tmp/e2e-worker.pid", String(worker.pid));
  worker.unref();
}
