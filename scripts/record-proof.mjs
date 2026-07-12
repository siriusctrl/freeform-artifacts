import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { stopProcessGroup, waitForServer } from "./lib/browser-server.mjs";

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
const uxChecksPath = path.join(outputDir, "ux-checks.json");
const port = Number(process.env.FREEFORM_PORT ?? 4180);
const host = "127.0.0.1";
const url = `http://${host}:${port}`;
const proofTrimStartSeconds = process.env.FREEFORM_PROOF_TRIM_START ?? "2.4";

mkdirSync(videoDir, { recursive: true });

const uxChecks = [];

function verifyUx(name, condition, details = {}) {
  const check = { name, passed: Boolean(condition), details };
  uxChecks.push(check);
  writeFileSync(uxChecksPath, `${JSON.stringify(uxChecks, null, 2)}\n`);
  if (!check.passed) {
    throw new Error(`UX check failed: ${name}\n${JSON.stringify(details, null, 2)}`);
  }
}

function worldPoint(viewport, screenPoint) {
  return {
    x: (screenPoint.x - viewport.x) / viewport.scale,
    y: (screenPoint.y - viewport.y) / viewport.scale,
  };
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function mediaDuration(mediaPath) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mediaPath],
    { encoding: "utf8" },
  );
  const duration = Number.parseFloat(probe.stdout.trim());
  if (probe.status !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe failed to read media duration: ${probe.stderr}`);
  }
  return duration;
}

async function installProofOverlay(page) {
  await page.evaluate(() => {
    document.querySelector("[data-proof-overlay]")?.remove();
    const overlay = document.createElement("div");
    overlay.dataset.proofOverlay = "true";
    overlay.innerHTML = '<div class="proof-step"></div><div class="proof-cursor"></div>';
    const style = document.createElement("style");
    style.textContent = `
      [data-proof-overlay] { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
      .proof-step { position: absolute; left: 24px; top: 72px; padding: 9px 13px; color: #fff;
        background: rgba(17, 20, 24, .9); border: 1px solid rgba(255,255,255,.18); border-radius: 6px;
        font: 600 13px/1.2 Geist, system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
      .proof-cursor { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border: 2px solid #111418; border-radius: 50%; background: rgba(255,255,255,.72);
        box-shadow: 0 0 0 3px rgba(82,196,218,.55); transform: translate(-30px,-30px); }
    `;
    overlay.append(style);
    document.body.append(overlay);
    window.addEventListener("pointermove", (event) => {
      const cursor = overlay.querySelector(".proof-cursor");
      if (cursor instanceof HTMLElement) {
        cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      }
    });
  });
}

async function showProofStep(page, label, pause = 500) {
  await page.evaluate((nextLabel) => {
    const step = document.querySelector("[data-proof-overlay] .proof-step");
    if (step) step.textContent = nextLabel;
  }, label);
  await page.waitForTimeout(pause);
}

async function dispatchPinch(page, stage, point, deltaY, count) {
  await stage.evaluate(async (element, gesture) => {
    for (let index = 0; index < gesture.count; index += 1) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: gesture.point.x,
          clientY: gesture.point.y,
          ctrlKey: true,
          deltaY: gesture.deltaY,
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 32));
    }
  }, { point, deltaY, count });
  await page.waitForTimeout(250);
}

async function findBlankStagePoint(page, stageBox) {
  const candidates = [];
  for (let y = stageBox.y + 100; y < stageBox.y + stageBox.height - 80; y += 80) {
    for (let x = stageBox.x + 80; x < stageBox.x + stageBox.width - 80; x += 100) {
      candidates.push({ x, y });
    }
  }

  return page.evaluate((points) => {
    return points.find(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(
        target?.closest('[data-testid="canvas-stage"]') &&
        !target.closest(".canvas-node, button, a, input, textarea, select"),
      );
    });
  }, candidates);
}

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

  if (frames.length < 12) {
    throw new Error("GIF frame check found too few sampled frames");
  }

  if (blankFrames.length > 0) {
    throw new Error(`GIF frame check found blank-like frames: ${blankFrames.map((frame) => frame.index).join(", ")}`);
  }

  return report;
}

const server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port), "--strictPort"], {
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
  let page = await context.newPage();

  await page.goto(url);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  const stage = page.getByTestId("canvas-stage");
  const grid = page.getByTestId("grid-plane");
  await stage.waitFor({ state: "visible" });
  await installProofOverlay(page);
  await showProofStep(page, "Inspect initial workspace", 900);

  const initialLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    state: window.__FREEFORM_STATE__,
  }));
  verifyUx("workspace fits the viewport", initialLayout.scrollWidth <= initialLayout.viewportWidth && initialLayout.scrollHeight <= initialLayout.viewportHeight, initialLayout);
  verifyUx("published template has a meaningful initial board", initialLayout.state?.nodes.length >= 5, {
    nodeCount: initialLayout.state?.nodes.length,
  });
  for (const control of ["snap-toggle", "import-data", "theme-toggle", "add-artifact", "zoom-level"]) {
    verifyUx(`control is visible: ${control}`, await page.getByTestId(control).isVisible());
  }

  const stageBox = await stage.boundingBox();
  const revenueNode = page.getByTestId("node-node-revenue");
  const nodeBox = await revenueNode.boundingBox();
  if (!stageBox || !nodeBox) {
    throw new Error("Canvas or revenue node was not visible enough to record proof");
  }

  await showProofStep(page, "Drag card • verify grid snap", 550);
  const beforeDrag = await page.evaluate(() => window.__FREEFORM_STATE__);
  await page.mouse.move(nodeBox.x + 82, nodeBox.y + 22);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 48, nodeBox.y + 132, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const afterDrag = await page.evaluate(() => window.__FREEFORM_STATE__);
  const draggedBefore = beforeDrag.nodes.find((node) => node.id === "node-revenue");
  const draggedAfter = afterDrag.nodes.find((node) => node.id === "node-revenue");
  verifyUx("card drag changes world position", draggedBefore?.x !== draggedAfter?.x || draggedBefore?.y !== draggedAfter?.y, {
    before: draggedBefore,
    after: draggedAfter,
  });
  verifyUx("card drag snaps to the world grid", draggedAfter?.x % afterDrag.snapGridSize === 0 && draggedAfter?.y % afterDrag.snapGridSize === 0, {
    node: draggedAfter,
    gridSize: afterDrag.snapGridSize,
  });
  verifyUx("drag does not select browser text", (await page.evaluate(() => window.getSelection()?.toString() ?? "")) === "");

  await showProofStep(page, "Resize chart • verify grid snap", 550);
  const beforeResize = await page.evaluate(() => window.__FREEFORM_STATE__);
  await page.getByTestId("node-node-probability").click({ position: { x: 120, y: 18 } });
  await page.waitForTimeout(150);
  const resizeHandle = page.getByTestId("resize-node-probability");
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox) {
    throw new Error("Probability resize handle was not visible enough to record proof");
  }
  const resizeCenter = {
    x: resizeBox.x + resizeBox.width / 2,
    y: resizeBox.y + resizeBox.height / 2,
  };
  const resizeHitTarget = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target instanceof Element && Boolean(target.closest(".resize-handle"));
  }, resizeCenter);
  verifyUx("resize handle has a reliable hit target", resizeHitTarget, { box: resizeBox });
  await resizeHandle.hover();
  await page.mouse.down();
  await page.mouse.move(resizeCenter.x + 76, resizeCenter.y + 48, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const afterResize = await page.evaluate(() => window.__FREEFORM_STATE__);
  const resizedBefore = beforeResize.nodes.find((node) => node.id === "node-probability");
  const resizedAfter = afterResize.nodes.find((node) => node.id === "node-probability");
  verifyUx("resize increases chart dimensions", resizedAfter?.width > resizedBefore?.width && resizedAfter?.height > resizedBefore?.height, {
    before: resizedBefore,
    after: resizedAfter,
  });
  verifyUx("resize snaps dimensions to the world grid", resizedAfter?.width % afterResize.snapGridSize === 0 && resizedAfter?.height % afterResize.snapGridSize === 0, {
    node: resizedAfter,
    gridSize: afterResize.snapGridSize,
  });

  await showProofStep(page, "Drag background • pan the whole world", 550);
  const blankStagePoint = await findBlankStagePoint(page, stageBox);
  verifyUx("a visible blank canvas region is available for drag-pan", Boolean(blankStagePoint), {
    stageBox,
  });
  const beforeDragPan = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  await page.mouse.move(blankStagePoint.x, blankStagePoint.y);
  await page.mouse.down();
  await page.mouse.move(blankStagePoint.x + 90, blankStagePoint.y - 60, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const afterDragPan = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  verifyUx("blank-stage drag pans without zooming", Math.round(afterDragPan.x - beforeDragPan.x) === 90 && Math.round(afterDragPan.y - beforeDragPan.y) === -60 && afterDragPan.scale === beforeDragPan.scale, {
    before: beforeDragPan,
    after: afterDragPan,
  });

  await showProofStep(page, "Two-finger scroll • pan on both axes", 600);
  const beforeWheelPan = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const gridBeforeWheel = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { position: style.backgroundPosition, size: style.backgroundSize };
  });
  await page.mouse.move(stageBox.x + 690, stageBox.y + 390);
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(40, 45);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(350);
  const afterWheelPan = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const gridAfterWheel = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { position: style.backgroundPosition, size: style.backgroundSize };
  });
  verifyUx("wheel pan follows both deltas and preserves scale", Math.round(afterWheelPan.x - beforeWheelPan.x) === -160 && Math.round(afterWheelPan.y - beforeWheelPan.y) === -180 && afterWheelPan.scale === beforeWheelPan.scale, {
    before: beforeWheelPan,
    after: afterWheelPan,
  });
  verifyUx("grid follows pan without changing interval", gridAfterWheel.position !== gridBeforeWheel.position && gridAfterWheel.size === gridBeforeWheel.size, {
    before: gridBeforeWheel,
    after: gridAfterWheel,
  });

  const pinchPoint = { x: stageBox.x + 690, y: stageBox.y + 390 };
  await showProofStep(page, "Pinch out • responsive pointer-anchored zoom", 600);
  const beforePinchOut = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorBeforePinchOut = worldPoint(beforePinchOut, pinchPoint);
  await dispatchPinch(page, stage, pinchPoint, -3, 12);
  const afterPinchOut = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorAfterPinchOut = worldPoint(afterPinchOut, pinchPoint);
  verifyUx("small pinch deltas produce a responsive zoom", afterPinchOut.scale / beforePinchOut.scale > 1.55, {
    beforeScale: beforePinchOut.scale,
    afterScale: afterPinchOut.scale,
  });
  verifyUx("pinch-out keeps the pointer anchor stable", pointDistance(anchorBeforePinchOut, anchorAfterPinchOut) < 0.01, {
    before: anchorBeforePinchOut,
    after: anchorAfterPinchOut,
  });

  await showProofStep(page, "Pinch in • preserve the same anchor", 550);
  const beforePinchIn = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorBeforePinchIn = worldPoint(beforePinchIn, pinchPoint);
  await dispatchPinch(page, stage, pinchPoint, 3, 8);
  const afterPinchIn = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorAfterPinchIn = worldPoint(afterPinchIn, pinchPoint);
  verifyUx("pinch-in reduces scale", afterPinchIn.scale < beforePinchIn.scale, {
    beforeScale: beforePinchIn.scale,
    afterScale: afterPinchIn.scale,
  });
  verifyUx("pinch-in keeps the pointer anchor stable", pointDistance(anchorBeforePinchIn, anchorAfterPinchIn) < 0.01, {
    before: anchorBeforePinchIn,
    after: anchorAfterPinchIn,
  });

  await showProofStep(page, "Toolbar zoom • then reset the viewport", 500);
  const beforeToolbarZoom = afterPinchIn.scale;
  await page.getByTestId("zoom-in").click();
  await page.waitForTimeout(350);
  const afterToolbarZoom = await page.evaluate(() => window.__FREEFORM_STATE__.viewport.scale);
  verifyUx("toolbar zoom changes scale", afterToolbarZoom > beforeToolbarZoom, {
    beforeScale: beforeToolbarZoom,
    afterScale: afterToolbarZoom,
  });
  await page.getByTitle("Reset view").click();
  await page.waitForTimeout(500);
  const afterReset = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  verifyUx("reset restores the initial viewport", afterReset.x === 80 && afterReset.y === 80 && afterReset.scale === 1, afterReset);

  await showProofStep(page, "Import database rows • verify transformed UI", 550);
  await page.getByTestId("import-data").click();
  await page.waitForTimeout(550);
  verifyUx("imported data reaches the rendered artifacts", await page.getByText("$232,400").isVisible());

  await showProofStep(page, "Switch theme • inspect the whole workspace", 550);
  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(600);
  verifyUx("theme switch reaches dark mode", (await page.evaluate(() => window.__FREEFORM_STATE__.themeMode)) === "dark");

  await showProofStep(page, "Add artifact • move it into the composition", 550);
  const beforeAdd = await page.evaluate(() => window.__FREEFORM_STATE__);
  await page.getByTestId("add-artifact").click();
  await page.waitForTimeout(350);
  const afterAdd = await page.evaluate(() => window.__FREEFORM_STATE__);
  verifyUx("add artifact inserts and selects one node", afterAdd.nodes.length === beforeAdd.nodes.length + 1 && afterAdd.selectedNodeId.startsWith("node-ai-"), {
    beforeCount: beforeAdd.nodes.length,
    afterCount: afterAdd.nodes.length,
    selectedNodeId: afterAdd.selectedNodeId,
  });
  const addedNode = page.getByTestId(`node-${afterAdd.selectedNodeId}`);
  const addedBox = await addedNode.boundingBox();
  if (!addedBox) throw new Error("Added artifact was not visible enough to move");
  const addedBeforeMove = afterAdd.nodes.find((node) => node.id === afterAdd.selectedNodeId);
  await page.mouse.move(addedBox.x + 80, addedBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(addedBox.x + 170, addedBox.y + 95, { steps: 16 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.status === "Saved locally");
  await page.waitForTimeout(450);
  const afterAddedMove = await page.evaluate(() => window.__FREEFORM_STATE__);
  const addedAfterMove = afterAddedMove.nodes.find((node) => node.id === afterAddedMove.selectedNodeId);
  verifyUx("new artifact remains draggable and snapped", (addedAfterMove?.x !== addedBeforeMove?.x || addedAfterMove?.y !== addedBeforeMove?.y) && addedAfterMove?.x % afterAddedMove.snapGridSize === 0 && addedAfterMove?.y % afterAddedMove.snapGridSize === 0, {
    before: addedBeforeMove,
    after: addedAfterMove,
  });

  await showProofStep(page, "Close page • preserve this browser’s workspace", 750);
  const persistedSnapshot = await page.evaluate(() => window.__FREEFORM_STATE__);
  const proofVideo = page.video();
  if (!proofVideo) throw new Error("Playwright did not attach a video recorder to the proof page");
  await page.close();
  const proofVideoPath = await proofVideo.path();

  page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const restoredStage = page.getByTestId("canvas-stage");
  await restoredStage.waitFor({ state: "visible" });
  await installProofOverlay(page);
  await showProofStep(page, "Workspace restored after reopening", 900);
  const restoredState = await page.evaluate(() => window.__FREEFORM_STATE__);
  verifyUx("reload restores all nodes", restoredState.nodes.length === persistedSnapshot.nodes.length, {
    beforeCount: persistedSnapshot.nodes.length,
    afterCount: restoredState.nodes.length,
  });
  const persistedAddedNode = persistedSnapshot.nodes.find((node) => node.id === persistedSnapshot.selectedNodeId);
  const restoredAddedNode = restoredState.nodes.find((node) => node.id === persistedSnapshot.selectedNodeId);
  verifyUx("reload restores the moved artifact position", restoredAddedNode?.x === persistedAddedNode?.x && restoredAddedNode?.y === persistedAddedNode?.y, {
    before: persistedAddedNode,
    after: restoredAddedNode,
  });
  verifyUx("reload restores theme and storage mode", restoredState.themeMode === "dark" && restoredState.storageMode === "indexeddb", {
    themeMode: restoredState.themeMode,
    storageMode: restoredState.storageMode,
  });
  verifyUx("all UX journey checks passed", uxChecks.every((check) => check.passed), { checkCount: uxChecks.length });

  await page.screenshot({ path: screenshotPath, fullPage: false });
  const state = await page.evaluate(() => window.__FREEFORM_STATE__);
  await context.close();
  await browser.close();
  browser = undefined;

  renameSync(proofVideoPath, webmPath);

  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      proofTrimStartSeconds,
      "-i",
      webmPath,
      "-loop",
      "1",
      "-t",
      "1.8",
      "-i",
      screenshotPath,
      "-filter_complex",
      "[0:v]fps=12,scale=960:-1:flags=lanczos[v0];[1:v]fps=12,scale=960:-1:flags=lanczos[v1];[v0][v1]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      gifPath,
    ],
    { stdio: "pipe" },
  );

  if (ffmpeg.status !== 0 || !existsSync(gifPath)) {
    throw new Error(`ffmpeg failed to create GIF: ${ffmpeg.stderr.toString()}`);
  }

  const proofDuration = mediaDuration(gifPath);
  const contactSheetFps = 30 / proofDuration;

  const contactSheet = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      gifPath,
      "-vf",
      `fps=${contactSheetFps.toFixed(6)},scale=280:-1:flags=lanczos,tile=5x6:padding=8:margin=8:color=white`,
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
    proofDuration,
    actions: [
      "inspect initial layout and controls",
      "drag node",
      "resize chart artifact",
      "drag-pan canvas",
      "wheel pan",
      "pinch zoom in and out around a stable pointer anchor",
      "toolbar zoom and viewport reset",
      "import query result",
      "toggle dark mode",
      "add and move artifact",
      "close, reopen, and restore the browser-local workspace",
      "capture screenshot",
    ],
    files: {
      gif: gifPath,
      webm: webmPath,
      screenshot: screenshotPath,
      contactSheet: contactSheetPath,
      frameCheck: frameCheckPath,
      uxChecks: uxChecksPath,
    },
    uxChecks,
    finalState: state,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    inspectionPath,
    [
      "Browser proof inspection",
      "",
      ...uxChecks.map((check) => `- PASS: ${check.name}`),
      `- PASS: ${frameCheck.frameCount} sampled GIF frames contained no blank-like frames.`,
      "- A dense 30-cell contact sheet was generated for temporal visual inspection.",
      "",
      `GIF: ${gifPath}`,
      `WebM: ${webmPath}`,
      `Screenshot: ${screenshotPath}`,
      `Contact sheet: ${contactSheetPath}`,
      `Frame check: ${frameCheckPath}`,
      `UX checks: ${uxChecksPath}`,
      "",
    ].join("\n"),
  );

  console.log(`Proof GIF: ${gifPath}`);
  console.log(`Recording: ${webmPath}`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Frame check: ${frameCheckPath}`);
  console.log(`UX checks: ${uxChecksPath}`);
} finally {
  if (browser) {
    await browser.close();
  }
  stopProcessGroup(server);
}
