import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflowDataDir = join(tmpdir(), `browser-replay-playwright-${process.pid}`);
const profileDataDir = join(tmpdir(), `browser-replay-profile-playwright-${process.pid}`);
const localPort = 41_873;
const baseURL = process.env.BROWSERBASE_E2E
  ? "http://127.0.0.1:3000"
  : `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.BROWSERBASE_E2E
    ? undefined
    : {
        command: "npm run build && npm start",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: String(localPort),
          PROFILE_DATA_DIR: profileDataDir,
          WORKFLOW_DATA_DIR: workflowDataDir,
        },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 960 } },
    },
  ],
});
