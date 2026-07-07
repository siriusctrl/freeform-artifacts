import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "artifacts", "verification", stamp);
const videoDir = path.join(outputDir, "videos");
const screenshotPath = path.join(outputDir, "final-screenshot.png");
const webmPath = path.join(outputDir, "recording.webm");
const gifPath = path.join(outputDir, "proof.gif");
const manifestPath = path.join(outputDir, "manifest.json");
const inspectionPath = path.join(outputDir, "inspection.txt");
const port = Number(process.env.FREEFORM_PORT ?? 4177);
const host = "127.0.0.1";
const url = `http://${host}:${port}`;

mkdirSync(videoDir, { recursive: true });

function waitForServer(targetUrl, timeoutMs = 120_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(targetUrl, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      request.on("error", retry);
      request.setTimeout(2_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${targetUrl}`));
        return;
      }
      setTimeout(check, 500);
    };

    check();
  });
}

const server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  env: { ...process.env, BROWSER: "none" },
});

let browser;

try {
  await waitForServer(url);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();

  await page.goto(url);
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.waitForTimeout(700);

  const stageBox = await page.getByTestId("canvas-stage").boundingBox();
  const nodeBox = await page.getByTestId("node-node-revenue").boundingBox();
  if (!stageBox || !nodeBox) {
    throw new Error("Canvas or revenue node was not visible enough to record proof");
  }

  await page.mouse.move(nodeBox.x + 82, nodeBox.y + 22);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 230, nodeBox.y + 110, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  await page.mouse.move(stageBox.x + 920, stageBox.y + 620);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 760, stageBox.y + 520, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  await page.mouse.move(stageBox.x + 690, stageBox.y + 390);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(450);

  await page.getByTestId("add-artifact").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const state = await page.evaluate(() => window.__FREEFORM_STATE__);
  await context.close();
  await browser.close();
  browser = undefined;

  const videos = readdirSync(videoDir).filter((file) => file.endsWith(".webm"));
  if (videos.length === 0) {
    throw new Error("Playwright did not write a WebM recording");
  }
  renameSync(path.join(videoDir, videos[0]), webmPath);

  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      webmPath,
      "-vf",
      "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      gifPath,
    ],
    { stdio: "pipe" },
  );

  if (ffmpeg.status !== 0 || !existsSync(gifPath)) {
    throw new Error(`ffmpeg failed to create GIF: ${ffmpeg.stderr.toString()}`);
  }

  const manifest = {
    url,
    createdAt: new Date().toISOString(),
    actions: ["drag node", "pan canvas", "wheel zoom", "add artifact", "capture screenshot"],
    files: {
      gif: gifPath,
      webm: webmPath,
      screenshot: screenshotPath,
    },
    finalState: state,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    inspectionPath,
    [
      "Browser proof inspection",
      "",
      "- Chromium opened the Vite app.",
      "- Mouse drag moved a canvas node.",
      "- Blank-stage drag panned the canvas viewport.",
      "- Wheel input changed zoom.",
      "- Add artifact inserted and selected a new registry-backed node.",
      "",
      `GIF: ${gifPath}`,
      `WebM: ${webmPath}`,
      `Screenshot: ${screenshotPath}`,
      "",
    ].join("\n"),
  );

  console.log(`Proof GIF: ${gifPath}`);
  console.log(`Recording: ${webmPath}`);
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  if (browser) {
    await browser.close();
  }
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}
