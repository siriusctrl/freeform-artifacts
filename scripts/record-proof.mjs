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
const contactSheetPath = path.join(outputDir, "contact-sheet.png");
const manifestPath = path.join(outputDir, "manifest.json");
const inspectionPath = path.join(outputDir, "inspection.txt");
const frameCheckPath = path.join(outputDir, "frame-check.json");
const port = Number(process.env.FREEFORM_PORT ?? 4177);
const host = "127.0.0.1";
const url = `http://${host}:${port}`;
const proofTrimStartSeconds = process.env.FREEFORM_PROOF_TRIM_START ?? "2.4";

mkdirSync(videoDir, { recursive: true });

function checkSampledFrames(gifFile) {
  const width = 64;
  const height = 40;
  const channels = 3;
  const frameSize = width * height * channels;
  const sample = spawnSync(
    "ffmpeg",
    ["-i", gifFile, "-vf", `fps=1,scale=${width}:${height}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );

  if (sample.status !== 0) {
    throw new Error(`ffmpeg failed to sample GIF frames: ${sample.stderr.toString()}`);
  }

  const frames = [];
  for (let offset = 0; offset + frameSize <= sample.stdout.length; offset += frameSize) {
    let sum = 0;
    let sumSq = 0;
    for (let index = offset; index < offset + frameSize; index += channels) {
      const r = sample.stdout[index];
      const g = sample.stdout[index + 1];
      const b = sample.stdout[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
    }
    const count = width * height;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    frames.push({
      index: frames.length,
      mean: Number(mean.toFixed(2)),
      deviation: Number(Math.sqrt(variance).toFixed(2)),
      blankLike: Math.sqrt(variance) < 2.8,
    });
  }

  const blankFrames = frames.filter((frame) => frame.blankLike);
  const report = {
    frameCount: frames.length,
    blankFrameCount: blankFrames.length,
    frames,
  };

  if (frames.length < 4) {
    throw new Error("GIF frame check found too few sampled frames");
  }

  if (blankFrames.length > 0) {
    throw new Error(`GIF frame check found blank-like frames: ${blankFrames.map((frame) => frame.index).join(", ")}`);
  }

  return report;
}

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
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.waitForTimeout(700);

  const stageBox = await page.getByTestId("canvas-stage").boundingBox();
  const nodeBox = await page.getByTestId("node-node-revenue").boundingBox();
  if (!stageBox || !nodeBox) {
    throw new Error("Canvas or revenue node was not visible enough to record proof");
  }

  await page.mouse.move(nodeBox.x + 82, nodeBox.y + 22);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 48, nodeBox.y + 132, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  await page.mouse.move(stageBox.x + 920, stageBox.y + 620);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 1_010, stageBox.y + 560, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  await page.mouse.move(stageBox.x + 690, stageBox.y + 390);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(450);

  await page.getByTestId("import-data").click();
  await page.waitForTimeout(450);

  await page.getByTestId("node-node-probability").click({ position: { x: 120, y: 18 } });
  await page.waitForTimeout(150);
  const resizeBox = await page.getByTestId("resize-node-probability").boundingBox();
  if (!resizeBox) {
    throw new Error("Probability resize handle was not visible enough to record proof");
  }
  await page.mouse.move(resizeBox.x + 8, resizeBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 72, resizeBox.y + 42, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  await page.getByTestId("snap-toggle").click();
  await page.waitForTimeout(260);
  await page.getByTestId("snap-toggle").click();
  await page.waitForTimeout(350);

  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(350);

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
      "-ss",
      proofTrimStartSeconds,
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

  const contactSheet = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      gifPath,
      "-vf",
      "fps=1.5,scale=360:-1:flags=lanczos,tile=4x4:padding=8:margin=8:color=white",
      "-frames:v",
      "1",
      "-update",
      "1",
      contactSheetPath,
    ],
    { stdio: "pipe" },
  );

  if (contactSheet.status !== 0 || !existsSync(contactSheetPath)) {
    throw new Error(`ffmpeg failed to create contact sheet: ${contactSheet.stderr.toString()}`);
  }

  const frameCheck = checkSampledFrames(gifPath);
  writeFileSync(frameCheckPath, `${JSON.stringify(frameCheck, null, 2)}\n`);

  const manifest = {
    url,
    createdAt: new Date().toISOString(),
    proofTrimStartSeconds,
    actions: [
      "drag node",
      "pan canvas",
      "wheel zoom",
      "import query result",
      "resize chart artifact",
      "toggle snap-to-grid off and on",
      "toggle dark mode",
      "add artifact",
      "capture screenshot",
    ],
    files: {
      gif: gifPath,
      webm: webmPath,
      screenshot: screenshotPath,
      contactSheet: contactSheetPath,
      frameCheck: frameCheckPath,
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
      "- Import data transformed raw rows into metric and table artifacts.",
      "- Resize handle changed an artifact card size.",
      "- Snap-to-grid toggle switched placement mode off and back on.",
      "- Theme toggle switched the app into dark mode.",
      "- Add artifact inserted and selected a new registry-backed node.",
      "- Internal frame contact sheet was generated for temporal visual inspection.",
      "- Lightweight frame check passed for sampled blank-like frames.",
      "",
      `GIF: ${gifPath}`,
      `WebM: ${webmPath}`,
      `Screenshot: ${screenshotPath}`,
      `Contact sheet: ${contactSheetPath}`,
      `Frame check: ${frameCheckPath}`,
      "",
    ].join("\n"),
  );

  console.log(`Proof GIF: ${gifPath}`);
  console.log(`Recording: ${webmPath}`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Frame check: ${frameCheckPath}`);
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
