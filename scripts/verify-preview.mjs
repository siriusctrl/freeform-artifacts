import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { stopProcessGroup, waitForServer } from "./lib/browser-server.mjs";

const root = process.cwd();
const port = Number(process.env.FREEFORM_PREVIEW_PORT ?? 4178);
const host = "127.0.0.1";
const url = `http://${host}:${port}`;

const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const server = spawn("npm", ["exec", "vite", "--", "preview", "--host", host, "--port", String(port)], {
  cwd: root,
  detached: true,
  stdio: "ignore",
});

let browser;

try {
  await waitForServer(url);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(url);
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("node-node-probability").waitFor({ state: "visible" });
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.artifactIds?.includes("runtime-margin-chart"));
  await page.getByTestId("import-data").click();
  await page.getByText("$232,400").waitFor({ state: "visible" });
  await page.getByTestId("theme-toggle").click();
  const state = await page.evaluate(() => window.__FREEFORM_STATE__);

  if (state?.themeMode !== "dark" || state?.snapToGrid !== true || !state?.artifactIds?.includes("runtime-margin-chart")) {
    throw new Error("Preview state did not reflect import and theme interactions");
  }

  console.log(`Preview verification passed: ${url}`);
} finally {
  if (browser) {
    await browser.close();
  }
  stopProcessGroup(server);
}
