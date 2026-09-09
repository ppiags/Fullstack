import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node src/server.js",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3100",
      DB_PATH: "data/e2e.db",
      HOLD_TTL_MS: "5000",
      ALLOW_TEST_ORDER_ID: "1",
    },
  },
});
