import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests always use the dedicated crm_test database (reset on every run by tests/global-setup.ts).

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // One shared database: run files sequentially for deterministic assertions.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      APP_ENV: "test",
      DATABASE_URL: `postgres://crm_app:crm_app_local_only@localhost:5432/crm_test`,
      DATABASE_OWNER_URL: `postgres://crm_owner:crm_owner_local_only@localhost:5432/crm_test`,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      IP_HASH_SALT: "test-salt-123",
      MESSAGING_PROVIDER: "local",
      LOG_LEVEL: "silent",
      SEED_PASSWORD: "Demo-Password-2026!",
    },
  },
});
