import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  MESSAGING_PROVIDER: z.enum(["local"]).default("local"),
  IP_HASH_SALT: z.string().min(8),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(500),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.string().default("info"),
  /** Test-only fault injection (see src/server/engine/faults.ts). Ignored outside APP_ENV=test. */
  CRM_FAULT: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema>;

export class ConfigError extends Error {}

/**
 * Validates configuration. Local provider adapters are rejected in production: a simulated send
 * must never be mistaken for a real one.
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const cfg = parsed.data;
  if (cfg.APP_ENV === "production" && cfg.MESSAGING_PROVIDER === "local") {
    throw new ConfigError("MESSAGING_PROVIDER=local (local simulation) is not permitted when APP_ENV=production");
  }
  if (cfg.APP_ENV === "production" && cfg.CRM_FAULT) {
    throw new ConfigError("CRM_FAULT fault injection is not permitted when APP_ENV=production");
  }
  return cfg;
}

let cached: AppConfig | undefined;
export function config(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}
