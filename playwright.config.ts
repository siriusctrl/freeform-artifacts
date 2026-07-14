import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.FREEFORM_TEST_PORT ?? 4177);
const testUrl = `http://127.0.0.1:${testPort}`;
const relayPort = Number(process.env.FREEFORM_RELAY_PORT ?? testPort + 4_610);
const relayUrl = `http://127.0.0.1:${relayPort}`;
const reuseDefaultServers = !process.env.CI &&
  !process.env.FREEFORM_TEST_PORT &&
  !process.env.FREEFORM_RELAY_PORT;

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: testUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `npx wrangler dev --config relay/wrangler.jsonc --local --ip 127.0.0.1 --port ${relayPort} --var ENVIRONMENT:development --var RELAY_ROUTING_SECRET:development-only-relay-routing-secret-0001 --var ALLOWED_ORIGINS:${testUrl}`,
      url: `${relayUrl}/health`,
      reuseExistingServer: reuseDefaultServers,
      timeout: 120_000,
    },
    {
      command: `VITE_RELAY_URL=${relayUrl} VITE_RELAY_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
      url: testUrl,
      reuseExistingServer: reuseDefaultServers,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/mobile.spec.ts",
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: "**/mobile.spec.ts",
    },
  ],
});
