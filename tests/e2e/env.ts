export const E2E_PORT = 3100;
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
export const e2eEnv: Record<string, string> = {
  APP_ENV: "test",
  APP_BASE_URL: E2E_BASE,
  BETTER_AUTH_URL: E2E_BASE,
  DATABASE_URL: "postgres://crm_app:crm_app_local_only@localhost:5432/crm_e2e",
  DATABASE_OWNER_URL: "postgres://crm_owner:crm_owner_local_only@localhost:5432/crm_e2e",
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
  IP_HASH_SALT: "e2e-salt-123",
  MESSAGING_PROVIDER: "local",
  SEED_PASSWORD: "Demo-Password-2026!",
  LOG_LEVEL: "warn",
  WORKER_POLL_MS: "200",
  AUTH_SIGNIN_LIMIT: "50",
};
