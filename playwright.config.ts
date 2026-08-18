import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://toolflow:toolflow@127.0.0.1:5432/toolflow";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const controlApiUrl = process.env.PLAYWRIGHT_CONTROL_API_URL ?? "http://127.0.0.1:3000";
const controlApiPort = new URL(controlApiUrl).port || "3000";
const adminPort = new URL(baseUrl).port || "5173";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "output/playwright/test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  use: {
    baseURL: baseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: [
        `DATABASE_URL=${databaseUrl}`,
        `PORT=${controlApiPort}`,
        "TOOLFLOW_ALLOW_INSECURE_DATABASE_TLS=true",
        `TOOLFLOW_ADMIN_ORIGIN=${baseUrl}`,
        "TOOLFLOW_OBJECT_STORE_PATH=.toolflow/e2e-objects",
        "pnpm --filter @toolflow/control-api exec node --import tsx src/index.ts",
      ].join(" "),
      url: `${controlApiUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: [
        `VITE_CONTROL_API_URL=${controlApiUrl}`,
        "VITE_DEV_AUTH=true",
        "VITE_DEV_USER_ID=00000000-0000-4000-8000-000000000001",
        "VITE_DEV_MEMBERSHIP_ID=00000000-0000-4000-8000-000000000002",
        "VITE_DEV_ORGANIZATION_ID=00000000-0000-4000-8000-000000000003",
        "VITE_DEV_ROLE=admin",
        `pnpm --filter @toolflow/admin exec vite --host 127.0.0.1 --port ${adminPort}`,
      ].join(" "),
      url: baseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
