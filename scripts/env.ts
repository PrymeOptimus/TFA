import { existsSync } from "node:fs";

/** Loads .env for scripts (Next.js loads it itself). Existing environment variables win. */
export function loadEnv() {
  if (existsSync(".env")) {
    const before = { ...process.env };
    process.loadEnvFile(".env");
    Object.assign(process.env, before);
  }
}
