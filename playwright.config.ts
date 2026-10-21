import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE, E2E_PORT, e2eEnv } from "./tests/e2e/env";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL: E2E_BASE, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    // Requires a prior `pnpm build` (the test:e2e script does this).
    command: `pnpm exec next start --port ${E2E_PORT}`,
    url: `${E2E_BASE}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: e2eEnv,
  },
});
