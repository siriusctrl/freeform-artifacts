import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.FREEFORM_TEST_PORT ?? 4177);
const testUrl = `http://127.0.0.1:${testPort}`;

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
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: testUrl,
    reuseExistingServer: !process.env.CI && !process.env.FREEFORM_TEST_PORT,
    timeout: 120_000,
  },
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
