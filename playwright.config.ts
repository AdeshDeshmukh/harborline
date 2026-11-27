import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3290";

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL,
    browserName: "chromium",
    serviceWorkers: "block",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3290",
    url: baseURL + "/demo",
    env: { APP_MODE: "demo", NEXT_TELEMETRY_DISABLED: "1" },
    reuseExistingServer: false,
  },
});
