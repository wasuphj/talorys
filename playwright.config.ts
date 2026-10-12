import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: "node scripts/dev-setup.mjs && node scripts/ensure-dist.mjs && node scripts/e2e-server.mjs",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
