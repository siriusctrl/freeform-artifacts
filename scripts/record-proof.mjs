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
        font: 600 13px/1.2 "Instrument Sans Variable", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
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

async function chartLabelLayout(page, hostTestId, labels) {
  return page.getByTestId(hostTestId).evaluate((host, expectedLabels) => {
    const hostRect = host.getBoundingClientRect();
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = expectedLabels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside =
          rect.left < hostRect.left - 1 ||
          rect.right > hostRect.right + 1 ||
          rect.top < hostRect.top - 1 ||
          rect.bottom > hostRect.bottom + 1;
        return outside ? [{ label, hostRight: hostRect.right, textRight: rect.right }] : [];
      }),
    };
  }, labels);
}

async function artifactPreviewGeometry(page, artifactId) {
  const preview = page.getByTestId(`artifact-preview-${artifactId}`);
  await preview.scrollIntoViewIfNeeded();
  await preview.waitFor({ state: "visible" });
  await page.waitForFunction(
    (id) => document.querySelector(`[data-testid="artifact-preview-${id}"]`)?.getAttribute("data-preview-ready") === "true",
    artifactId,
  );
  return preview.evaluate((frame) => {
    const node = frame.querySelector(".artifact-preview-node");
    if (!(node instanceof HTMLElement)) return null;
    const frameRect = frame.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      artifactId: frame.dataset.testid,
      scale: Number(frame.getAttribute("data-preview-scale")),
      frame: { width: frameRect.width, height: frameRect.height },
      node: { width: nodeRect.width, height: nodeRect.height },
      contained:
        nodeRect.left >= frameRect.left - 1 &&
        nodeRect.right <= frameRect.right + 1 &&
        nodeRect.top >= frameRect.top - 1 &&
        nodeRect.bottom <= frameRect.bottom + 1,
    };
  });
}

async function probabilityNoteLayout(page) {
  return page.getByTestId("echarts-inflection-probability").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    const objectScale = hostRect.width / host.clientWidth;
    const compact = host.clientWidth < 640 || host.clientHeight < 400;
    const horizontalPadding = compact ? 18 : 24;
    const noteTop = compact ? 52 : 62;
    const noteHeight = compact ? 90 : 76;
    const panel = {
      left: hostRect.left + horizontalPadding * objectScale,
      right: hostRect.right - horizontalPadding * objectScale,
      top: hostRect.top + noteTop * objectScale,
      bottom: hostRect.top + (noteTop + noteHeight) * objectScale,
    };
    const labels = ["What:", "Read:", "Logic:"];
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = labels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      tops: matches.flatMap(({ element }) => element ? [Math.round(element.getBoundingClientRect().top)] : []),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside = rect.left < panel.left - 1 || rect.right > panel.right + 1 || rect.top < panel.top - 1 || rect.bottom > panel.bottom + 1;
        return outside ? [{ label, panel, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }] : [];
      }),
    };
  });
}

async function sankeyNodeColors(page) {
  return page.getByTestId("echarts-sankey-flow").locator("svg").evaluate((svg) =>
    [...svg.querySelectorAll("path")]
      .map((path) => path.getAttribute("fill"))
      .filter((fill) => fill && fill !== "none" && !fill.startsWith("url") && fill !== "rgb(0,0,0)"),
  );
}

async function pipelineConnectorGeometry(page) {
  return page.locator(".flow-grid").evaluate((grid) => {
    const connector = grid.querySelector(".flow-connector").getBoundingClientRect();
    const markers = [...grid.querySelectorAll(".flow-step-node")].map((marker) => marker.getBoundingClientRect());
    return {
      connectorLeft: connector.left,
      connectorRight: connector.right,
      firstCenter: markers[0].left + markers[0].width / 2,
      lastCenter: markers.at(-1).left + markers.at(-1).width / 2,
    };
  });
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

function proofArtifactBundle() {
  return {
    version: 1,
    artifactId: "agent-capacity-card",
    moduleSource: `export const artifact = {
      id: "agent-capacity-card", renderer: "chart-kit",
      title: "Agent Capacity", version: "1.0.0", defaultSize: { width: 480, height: 300 },
      buildChart: ({ data }) => ({
        kind: "cartesian", title: data.title,
        categories: data.points.map((point) => point.label),
        series: [{ id: "capacity", name: "Capacity", type: "bar", values: data.points.map((point) => point.value) }],
      }),
    };`,
    node: {
      title: "Agent capacity",
      data: { title: "Installed directly into this view", points: [{ label: "North", value: 34 }, { label: "South", value: 47 }] },
      config: {},
    },
  };
}

function brokenProofArtifactBundle() {
  return {
    version: 1,
    artifactId: "broken-proof-card",
    moduleSource: `export const artifact = {
      id: "broken-proof-card", renderer: "chart-kit", title: "Broken proof card",
      version: "1.0.0", defaultSize: { width: 420, height: 260 },
      buildChart: () => ({ kind: "cartesian", categories: ["North", "South"],
        series: [{ id: "capacity", name: "Capacity", type: "bar", values: [34] }] }),
    };`,
    node: { title: "Broken proof card", data: {}, config: {} },
  };
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
    permissions: ["clipboard-read", "clipboard-write"],
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
  await showProofStep(page, "Compact top bar • lighter type and grouped controls", 1300);

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
  for (const control of ["theme-toggle", "workspace-menu", "build-artifact", "zoom-level"]) {
    verifyUx(`control is visible: ${control}`, await page.getByTestId(control).isVisible());
  }
  const topbarMetrics = await page.evaluate(() => ({
    topbar: Math.round(document.querySelector(".topbar")?.getBoundingClientRect().height ?? 0),
    toolStrip: Math.round(document.querySelector(".tool-strip")?.getBoundingClientRect().height ?? 0),
    theme: Math.round(document.querySelector('[data-testid="theme-toggle"]')?.getBoundingClientRect().height ?? 0),
    more: Math.round(document.querySelector('[data-testid="workspace-menu"]')?.getBoundingClientRect().height ?? 0),
    status: Math.round(document.querySelector('[data-testid="board-status"]')?.getBoundingClientRect().height ?? 0),
    statusWidth: Math.round(document.querySelector('[data-testid="board-status"]')?.getBoundingClientRect().width ?? 0),
    statusRight: document.querySelector('[data-testid="board-status"]')?.getBoundingClientRect().right ?? 0,
    themeLeft: document.querySelector('[data-testid="theme-toggle"]')?.getBoundingClientRect().left ?? 0,
    moreLeft: document.querySelector('[data-testid="workspace-menu"]')?.getBoundingClientRect().left ?? 0,
    buildLeft: document.querySelector('[data-testid="build-artifact"]')?.getBoundingClientRect().left ?? 0,
    build: Math.round(document.querySelector('[data-testid="build-artifact"]')?.getBoundingClientRect().height ?? 0),
    brandFont: getComputedStyle(document.querySelector(".title-block")).fontFamily,
    fontLoaded: document.fonts.check('16px "Instrument Sans Variable"'),
  }));
  verifyUx(
    "compact top bar uses a deliberate control hierarchy",
    topbarMetrics.topbar === 54 && topbarMetrics.toolStrip === 36 && topbarMetrics.theme === 30 && topbarMetrics.more === 30 && topbarMetrics.status === 34 && topbarMetrics.statusWidth === 128 && topbarMetrics.build === 38,
    topbarMetrics,
  );
  verifyUx("save status sits before Theme and More", topbarMetrics.statusRight < topbarMetrics.themeLeft, topbarMetrics);
  verifyUx("Instrument Sans is loaded and applied to product chrome", topbarMetrics.fontLoaded && topbarMetrics.brandFont.includes("Instrument Sans Variable"), { fontFamily: topbarMetrics.brandFont, fontLoaded: topbarMetrics.fontLoaded });
  const moreIconCenterDelta = await page.getByTestId("workspace-menu").evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const iconRect = button.querySelector("svg")?.getBoundingClientRect();
    if (!iconRect) return Number.POSITIVE_INFINITY;
    return Math.abs((buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2));
  });
  verifyUx("More icon is optically centered", moreIconCenterDelta <= 0.5, { centerDelta: moreIconCenterDelta });
  await page.getByTestId("workspace-menu").click();
  const snapSetting = page.getByTestId("snap-toggle");
  verifyUx(
    "snap setting uses a compact switch and is initially on",
    (await snapSetting.getAttribute("aria-checked")) === "true" &&
      (await snapSetting.getByText("Snap to grid").isVisible()) &&
      (await snapSetting.locator(".menu-switch").evaluate((element) => element.getBoundingClientRect().width)) === 32,
  );
  await page.getByTestId("snap-toggle").click();
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.snapToGrid === false);
  verifyUx("snap switch shows immediate off feedback", (await snapSetting.getAttribute("aria-checked")) === "false");
  await page.getByTestId("snap-toggle").click();
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.snapToGrid === true);
  verifyUx("snap switch returns to on", (await snapSetting.getAttribute("aria-checked")) === "true");
  await page.getByTestId("workspace-menu").click();
  verifyUx("redundant select control is absent", (await page.getByTitle("Select").count()) === 0);
  verifyUx("selection inspector is absent from the product UI", (await page.locator(".inspector").count()) === 0);
  const initialProbabilityLayout = await chartLabelLayout(page, "echarts-inflection-probability", ["P75"]);
  verifyUx(
    "probability markers fit inside the chart host",
    initialProbabilityLayout.missing.length === 0 && initialProbabilityLayout.overflow.length === 0,
    initialProbabilityLayout,
  );
  const initialProbabilityNote = await probabilityNoteLayout(page);
  verifyUx(
    "probability note uses three contained lines",
    initialProbabilityNote.missing.length === 0 && initialProbabilityNote.overflow.length === 0 && new Set(initialProbabilityNote.tops).size === 3,
    initialProbabilityNote,
  );
  verifyUx("published probability example uses generic supply wording", await page.getByText("Supply-demand probability", { exact: true }).isVisible());
  const initialSankeyLayout = await chartLabelLayout(page, "echarts-sankey-flow", ["North", "South"]);
  verifyUx(
    "Sankey labels fit inside the chart host",
    initialSankeyLayout.missing.length === 0 && initialSankeyLayout.overflow.length === 0,
    initialSankeyLayout,
  );
  await showProofStep(page, "Polished examples • clear hierarchy and distinct flow colors", 1500);
  verifyUx("table hides internal data names", (await page.getByText(/^[a-z]+_[a-z_]+$/).count()) === 0 && (await page.locator(".table-title").count()) === 0);
  verifyUx("pipeline removes cramped counters and decoration", (await page.locator(".flow-step").count()) === 3 && (await page.locator(".flow-step-index, .flow-rail").count()) === 0);
  verifyUx("supply example stays generic", await page.getByText("Supply-demand probability", { exact: true }).isVisible() && await page.getByText("Supply Model", { exact: true }).isVisible());
  const lightSankeyColors = [...new Set(await sankeyNodeColors(page))];
  verifyUx("light Sankey assigns six distinct node colors", lightSankeyColors.length === 6, { lightSankeyColors });

  await showProofStep(page, "Pipeline continuity • one line passes through all three stages", 900);
  await stage.dispatchEvent("wheel", { deltaX: -170, deltaY: 390 });
  await page.waitForTimeout(1400);
  const connectorGeometry = await pipelineConnectorGeometry(page);
  verifyUx(
    "pipeline connector reaches the first and last marker centers",
    Math.abs(connectorGeometry.connectorLeft - connectorGeometry.firstCenter) <= 1 &&
      Math.abs(connectorGeometry.connectorRight - connectorGeometry.lastCenter) <= 1,
    connectorGeometry,
  );
  await page.getByTitle("Reset view").click();
  await page.waitForTimeout(700);

  await showProofStep(page, "Rename canvas • edit the centered title", 900);
  await page.getByTestId("canvas-title").focus();
  await page.getByTestId("canvas-title").press("F2");
  const titleInput = page.getByTestId("canvas-title-input");
  await titleInput.press("Control+A");
  await titleInput.pressSequentially("Market canvas", { delay: 65 });
  await page.waitForTimeout(500);
  await titleInput.press("Enter");
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.status === "Saved locally");
  await page.waitForTimeout(900);
  verifyUx("keyboard rename persists the centered canvas title", await page.getByTestId("canvas-title").getByText("Market canvas").isVisible());
  const topbarPositionsAfterSave = await page.evaluate(() => ({
    themeLeft: document.querySelector('[data-testid="theme-toggle"]')?.getBoundingClientRect().left ?? 0,
    moreLeft: document.querySelector('[data-testid="workspace-menu"]')?.getBoundingClientRect().left ?? 0,
    buildLeft: document.querySelector('[data-testid="build-artifact"]')?.getBoundingClientRect().left ?? 0,
  }));
  verifyUx(
    "save status changes do not shift toolbar commands",
    topbarPositionsAfterSave.themeLeft === topbarMetrics.themeLeft &&
      topbarPositionsAfterSave.moreLeft === topbarMetrics.moreLeft &&
      topbarPositionsAfterSave.buildLeft === topbarMetrics.buildLeft,
    { before: topbarMetrics, after: topbarPositionsAfterSave },
  );

  await showProofStep(page, "Shortcut • Cmd+B toggles Views without touching the canvas", 650);
  await page.keyboard.press("Meta+b");
  await page.getByTestId("canvas-sidebar").waitFor({ state: "visible" });
  verifyUx("Cmd+B opens the Views sidebar", await page.getByTestId("canvas-sidebar").isVisible());
  await page.keyboard.press("Meta+b");
  await page.waitForTimeout(350);
  verifyUx("Cmd+B closes the Views sidebar", !(await page.getByTestId("canvas-sidebar").isVisible()));

  await showProofStep(page, "Open Views • preview this canvas as the sidebar glides in", 900);
  const sidebarSlot = page.locator(".canvas-sidebar-slot");
  const closedSidebarWidth = await sidebarSlot.evaluate((element) => element.getBoundingClientRect().width);
  const sidebarWidths = await sidebarSlot.evaluate(async (element) => {
    document.querySelector('[data-testid="sidebar-toggle"]')?.click();
    const widths = [];
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      widths.push(element.getBoundingClientRect().width);
    }
    return widths;
  });
  const openSidebarWidth = sidebarWidths.at(-1);
  const hasIntermediateWidth = sidebarWidths.some((width) => width > 0 && width < openSidebarWidth);
  verifyUx("Views sidebar animates through intermediate widths", closedSidebarWidth === 0 && openSidebarWidth === 264 && hasIntermediateWidth, { closedSidebarWidth, sidebarWidths, openSidebarWidth });
  verifyUx("sidebar opens only on request", await page.getByTestId("canvas-sidebar").isVisible());
  verifyUx("saved canvas preview reflects real board nodes", (await page.getByTestId("view-preview-market-overview").locator(".view-preview-node").count()) === 5);
  await showProofStep(page, "Sidebar zoom • keep the pointer anchor stable", 700);
  const sidebarZoom = await stage.evaluate(async (element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: Math.round(rect.left + rect.width * 0.66), y: Math.round(rect.top + rect.height * 0.42) };
    const local = { x: point.x - rect.left, y: point.y - rect.top };
    const before = window.__FREEFORM_STATE__.viewport;
    const world = { x: (local.x - before.x) / before.scale, y: (local.y - before.y) / before.scale };
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, ctrlKey: true, deltaY: -12 }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = window.__FREEFORM_STATE__.viewport;
    const afterWorld = { x: (local.x - after.x) / after.scale, y: (local.y - after.y) / after.scale };
    return { before, after, drift: Math.hypot(afterWorld.x - world.x, afterWorld.y - world.y) };
  });
  verifyUx("sidebar-open pinch zoom preserves its world anchor", sidebarZoom.after.scale > sidebarZoom.before.scale && sidebarZoom.drift < 0.000001, sidebarZoom);
  await page.getByTitle("Reset view").click();
  await page.waitForTimeout(500);
  await page.getByTestId("create-view").click();
  await page.waitForTimeout(900);
  const secondViewId = await page.evaluate(() => window.__FREEFORM_AGENT__.activeViewId);
  verifyUx("new canvas is an empty independent view", secondViewId !== "market-overview" && (await page.evaluate(() => window.__FREEFORM_STATE__.nodes.length)) === 0, { secondViewId });
  verifyUx("new empty view has an empty page preview", (await page.getByTestId(`view-preview-${secondViewId}`).locator(".view-preview-node").count()) === 0);
  await page.getByTestId("canvas-title").dblclick();
  const secondTitleInput = page.getByTestId("canvas-title-input");
  await secondTitleInput.press("Control+A");
  await secondTitleInput.pressSequentially("Scenario canvas", { delay: 55 });
  await secondTitleInput.press("Enter");
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.status === "Saved locally");
  await page.waitForTimeout(900);

  await showProofStep(page, "Switch canvas • restore the first view", 800);
  await page.getByTestId("view-market-overview").click();
  await page.getByTestId("node-node-revenue").waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
  const viewSummaries = await page.evaluate(() => window.__FREEFORM_AGENT__.listViews());
  verifyUx("view switch restores the first canvas and keeps both names", (await page.getByTestId("canvas-title").innerText()) === "Market canvas" && viewSummaries.some((view) => view.title === "Scenario canvas"), { viewSummaries });
  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(500);

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

  await showProofStep(page, "Resize chart • watch the complete object scale", 1000);
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
  const probabilityHost = page.getByTestId("echarts-inflection-probability");
  const probabilityMarker = probabilityHost.locator("svg text").filter({ hasText: "P75:" }).first();
  const probabilityDeleteBefore = await page.getByTestId("delete-node-probability").boundingBox();
  const probabilityMarkerBefore = await probabilityMarker.boundingBox();
  const probabilityHostBefore = await probabilityHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  await resizeHandle.hover();
  await page.mouse.down();
  await page.mouse.move(resizeCenter.x + 150, resizeCenter.y + 96, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const afterResize = await page.evaluate(() => window.__FREEFORM_STATE__);
  const resizedBefore = beforeResize.nodes.find((node) => node.id === "node-probability");
  const resizedAfter = afterResize.nodes.find((node) => node.id === "node-probability");
  verifyUx("resize increases chart dimensions", resizedAfter?.width > resizedBefore?.width && resizedAfter?.height > resizedBefore?.height, {
    before: resizedBefore,
    after: resizedAfter,
  });
  const resizeScale = resizedAfter.width / resizedBefore.width;
  const probabilityDeleteAfter = await page.getByTestId("delete-node-probability").boundingBox();
  const probabilityMarkerAfter = await probabilityMarker.boundingBox();
  const probabilityHostAfter = await probabilityHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  verifyUx(
    "resize preserves the artifact aspect ratio",
    Math.abs(resizedAfter.width / resizedAfter.height - 720 / 460) < 0.0001,
    { node: resizedAfter },
  );
  verifyUx(
    "resize scales the fixed artifact coordinate system",
    probabilityHostAfter.clientWidth === probabilityHostBefore.clientWidth &&
      Math.abs(probabilityHostAfter.screenWidth / probabilityHostBefore.screenWidth - resizeScale) < 0.01,
    { before: probabilityHostBefore, after: probabilityHostAfter, resizeScale },
  );
  verifyUx(
    "chart content and Delete follow the same object scale",
    Boolean(
      probabilityDeleteBefore && probabilityDeleteAfter && probabilityMarkerBefore && probabilityMarkerAfter &&
      Math.abs(probabilityDeleteAfter.width / probabilityDeleteBefore.width - resizeScale) < 0.01 &&
      Math.abs(probabilityMarkerAfter.height / probabilityMarkerBefore.height - resizeScale) < 0.08
    ),
    { probabilityDeleteBefore, probabilityDeleteAfter, probabilityMarkerBefore, probabilityMarkerAfter, resizeScale },
  );
  const probabilityLabelLayout = await chartLabelLayout(page, "echarts-inflection-probability", ["P75"]);
  verifyUx(
    "probability markers remain contained after resize",
    probabilityLabelLayout.missing.length === 0 && probabilityLabelLayout.overflow.length === 0,
    probabilityLabelLayout,
  );
  const resizedProbabilityNote = await probabilityNoteLayout(page);
  verifyUx(
    "probability note remains contained after resize",
    resizedProbabilityNote.missing.length === 0 && resizedProbabilityNote.overflow.length === 0 && new Set(resizedProbabilityNote.tops).size === 3,
    resizedProbabilityNote,
  );

  await showProofStep(page, "Resize chart back • restore the composition", 800);
  const enlargedResizeBox = await resizeHandle.boundingBox();
  if (!enlargedResizeBox) throw new Error("Enlarged probability resize handle is not visible");
  const enlargedResizeCenter = {
    x: enlargedResizeBox.x + enlargedResizeBox.width / 2,
    y: enlargedResizeBox.y + enlargedResizeBox.height / 2,
  };
  await page.mouse.move(enlargedResizeCenter.x, enlargedResizeCenter.y);
  await page.mouse.down();
  await page.mouse.move(enlargedResizeCenter.x - 150, enlargedResizeCenter.y - 96, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const restoredProbability = (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.find(
    (node) => node.id === "node-probability",
  );
  verifyUx(
    "reverse handle drag returns the chart near its original size",
    Math.abs(restoredProbability.width - resizedBefore.width) < 2 && Math.abs(restoredProbability.height - resizedBefore.height) < 2,
    { original: resizedBefore, restored: restoredProbability },
  );

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
  const pinchStagePoint = { x: pinchPoint.x - stageBox.x, y: pinchPoint.y - stageBox.y };
  await showProofStep(page, "Pinch out • responsive pointer-anchored zoom", 600);
  const beforePinchOut = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorBeforePinchOut = worldPoint(beforePinchOut, pinchStagePoint);
  await dispatchPinch(page, stage, pinchPoint, -3, 12);
  const afterPinchOut = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorAfterPinchOut = worldPoint(afterPinchOut, pinchStagePoint);
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
  const anchorBeforePinchIn = worldPoint(beforePinchIn, pinchStagePoint);
  await dispatchPinch(page, stage, pinchPoint, 3, 8);
  const afterPinchIn = await page.evaluate(() => window.__FREEFORM_STATE__.viewport);
  const anchorAfterPinchIn = worldPoint(afterPinchIn, pinchStagePoint);
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

  await showProofStep(page, "Resize Sankey • watch content and controls shrink together", 1000);
  await page.mouse.move(stageBox.x + 700, stageBox.y + 400);
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(112.5, 120);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(350);
  await page.getByTestId("node-node-sankey").click({ position: { x: 120, y: 18 } });
  const sankeyLabel = page.getByTestId("echarts-sankey-flow").locator("svg text").filter({ hasText: "North" }).first();
  const sankeyHost = page.getByTestId("echarts-sankey-flow");
  const sankeyHostBefore = await sankeyHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  const sankeyDeleteBefore = await page.getByTestId("delete-node-sankey").boundingBox();
  const sankeyLabelBefore = await sankeyLabel.boundingBox();
  const sankeyResize = page.getByTestId("resize-node-sankey");
  const sankeyResizeBox = await sankeyResize.boundingBox();
  if (!sankeyResizeBox) throw new Error("Sankey resize handle was not visible enough to record proof");
  await sankeyResize.hover();
  await page.mouse.down();
  await page.mouse.move(sankeyResizeBox.x - 400, sankeyResizeBox.y - 300, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const resizedSankey = (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.find(
    (node) => node.id === "node-sankey",
  );
  verifyUx("Sankey resize respects its proportional artifact minimum", resizedSankey?.width === 570 && resizedSankey?.height === 342, {
    node: resizedSankey,
  });
  const sankeyDeleteAfter = await page.getByTestId("delete-node-sankey").boundingBox();
  const sankeyLabelAfter = await sankeyLabel.boundingBox();
  const sankeyHostAfter = await sankeyHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  verifyUx(
    "selected-card controls follow card resize scale",
    Boolean(sankeyDeleteBefore && sankeyDeleteAfter && sankeyDeleteAfter.width < sankeyDeleteBefore.width * 0.97),
    { before: sankeyDeleteBefore, after: sankeyDeleteAfter },
  );
  verifyUx(
    "Sankey uses fixed internal coordinates and uniform object scaling",
    Boolean(
      sankeyLabelBefore && sankeyLabelAfter &&
      sankeyHostBefore.clientWidth === sankeyHostAfter.clientWidth &&
      sankeyHostAfter.screenWidth < sankeyHostBefore.screenWidth &&
      sankeyLabelAfter.height < sankeyLabelBefore.height
    ),
    { hostBefore: sankeyHostBefore, hostAfter: sankeyHostAfter, labelBefore: sankeyLabelBefore, labelAfter: sankeyLabelAfter },
  );
  const sankeyLabelLayout = await chartLabelLayout(page, "echarts-sankey-flow", ["North", "South"]);
  verifyUx(
    "Sankey labels remain contained at minimum size",
    sankeyLabelLayout.missing.length === 0 && sankeyLabelLayout.overflow.length === 0,
    sankeyLabelLayout,
  );
  await page.getByTitle("Reset view").click();
  await page.waitForTimeout(500);

  await showProofStep(page, "Import database rows • verify transformed UI", 550);
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("import-data").click();
  await page.waitForTimeout(550);
  verifyUx("imported data reaches the rendered artifacts", await page.getByText("$232,400").isVisible());

  await showProofStep(page, "Switch theme • inspect the whole workspace", 550);
  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(600);
  verifyUx("theme switch reaches dark mode", (await page.evaluate(() => window.__FREEFORM_STATE__.themeMode)) === "dark");
  const darkSankeyColors = [...new Set(await sankeyNodeColors(page))];
  verifyUx("dark mode supplies a distinct six-color Sankey palette", darkSankeyColors.length === 6 && darkSankeyColors.some((color) => !lightSankeyColors.includes(color)), { lightSankeyColors, darkSankeyColors });

  await showProofStep(page, "Build with AI • generate a no-code bundle handoff", 900);
  const beforeHandoff = await page.evaluate(() => window.__FREEFORM_STATE__);
  await page.getByTestId("build-artifact").click();
  await page.waitForTimeout(900);
  const instruction = await page.getByTestId("agent-instruction").innerText();
  verifyUx("AI handoff is agent-neutral and asks the agent to discover the request", instruction.includes("Install the project artifact skill for your agent:") && instruction.includes("ask the user what artifact they want to build") && !instruction.includes("Claude Code"));
  verifyUx("AI handoff explicitly selects browser bundle delivery", instruction.includes("Delivery mode: BROWSER_VIEW_BUNDLE") && instruction.includes("Do not use the Self-Deployed Repo workflow") && instruction.includes("Do not create src/artifacts/generated files"));
  verifyUx("AI handoff validates Chart Kit before browser installation", instruction.includes('renderer: "chart-kit"') && instruction.includes("window.__FREEFORM_AGENT__.validateArtifact") && instruction.includes("window.__FREEFORM_AGENT__.installArtifact"));
  await page.getByTestId("copy-agent-instruction").click();
  await page.getByTestId("copy-agent-instruction").getByText("Copied").waitFor({ state: "visible" });
  verifyUx("AI handoff can be copied", await page.getByTestId("copy-agent-instruction").getByText("Copied").isVisible());
  const afterHandoff = await page.evaluate(() => window.__FREEFORM_STATE__);
  verifyUx("AI handoff does not insert a fake template card", afterHandoff.nodes.length === beforeHandoff.nodes.length, {
    beforeCount: beforeHandoff.nodes.length,
    afterCount: afterHandoff.nodes.length,
  });
  await page.getByTitle("Close", { exact: true }).click();
  await page.waitForTimeout(500);

  await showProofStep(page, "Agent install • add a real artifact to this view", 1000);
  const beforeInstall = await page.evaluate(() => window.__FREEFORM_STATE__);
  const proofBundle = proofArtifactBundle();
  const proofValidation = await page.evaluate((bundle) => window.__FREEFORM_AGENT__.validateArtifact(bundle), proofBundle);
  verifyUx("Agent API validates Chart Kit without persistence", proofValidation.renderer === "chart-kit" && proofValidation.renderChecks === 4 && proofValidation.persisted === false, proofValidation);
  let installedArtifact = await page.evaluate((bundle) => window.__FREEFORM_AGENT__.installArtifact(bundle), proofBundle);
  await page.getByTestId(`node-${installedArtifact.nodeId}`).waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  const afterInstall = await page.evaluate(() => window.__FREEFORM_STATE__);
  verifyUx("Agent API installs and selects a persisted artifact without a deploy", afterInstall.nodes.length === beforeInstall.nodes.length + 1 && afterInstall.artifactIds.includes("agent-capacity-card"), { installedArtifact });
  verifyUx("installed artifact renders its generated content", await page.getByText("Installed directly into this view").isVisible());

  await showProofStep(page, "Invalid artifact • reject before installation", 900);
  const nodeCountBeforeRejection = (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.length;
  const rejectionMessage = await page.evaluate(async (bundle) => {
    try {
      await window.__FREEFORM_AGENT__.validateArtifact(bundle);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, brokenProofArtifactBundle());
  verifyUx("Chart Kit preflight rejects invalid series before persistence", rejectionMessage.includes("must match the category count"), { rejectionMessage });
  verifyUx("preflight rejection leaves the canvas unchanged", (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.length === nodeCountBeforeRejection);
  verifyUx("healthy runtime artifact remains rendered after rejection", await page.getByText("Installed directly into this view").isVisible());
  await page.waitForTimeout(1200);

  await showProofStep(page, "Delete personal card • keep its package in the shared library", 650);
  await page.getByTestId(`node-${installedArtifact.nodeId}`).click({ position: { x: 100, y: 18 } });
  await page.keyboard.press("Delete");
  await page.getByTestId(`node-${installedArtifact.nodeId}`).waitFor({ state: "detached" });
  await page.keyboard.press("Meta+Shift+a");
  await page.getByTestId("artifact-library").waitFor({ state: "visible" });
  const libraryCounts = await page.evaluate(() => window.__FREEFORM_STATE__.artifactLibraryCounts);
  verifyUx("Shift+Cmd+A opens the shared Artifact Library", await page.getByTestId("artifact-library").isVisible());
  verifyUx("Artifact Library exposes five built-ins and one personal package", libraryCounts.builtIn === 5 && libraryCounts.personal === 1, libraryCounts);
  verifyUx(
    "Artifact Library replaces renderer glyphs and technical labels with real previews",
    (await page.locator(".artifact-library-glyph, .artifact-library-copy small").count()) === 0,
  );
  await showProofStep(page, "Artifact previews • real renderers, scaled whole rather than cropped", 900);
  const previewGeometries = [];
  const previewRendererChecks = [];
  for (const artifactId of ["metric-card", "table-preview", "flow-diagram", "inflection-probability", "sankey-flow"]) {
    previewGeometries.push(await artifactPreviewGeometry(page, artifactId));
    if (artifactId === "flow-diagram") {
      previewRendererChecks.push((await page.getByTestId("artifact-preview-flow-diagram").locator(".flow-diagram").count()) === 1);
    }
    if (artifactId === "inflection-probability" || artifactId === "sankey-flow") {
      previewRendererChecks.push((await page.getByTestId(`preview-echarts-${artifactId}`).locator("svg").count()) === 1);
    }
  }
  verifyUx(
    "all five built-in previews contain the complete rendered artifact",
    previewGeometries.every((geometry) => geometry?.contained && geometry.scale > 0 && geometry.scale <= 1),
    { previewGeometries },
  );
  verifyUx(
    "preview catalog mounts the real React and ECharts renderers",
    previewRendererChecks.length === 3 && previewRendererChecks.every(Boolean),
    { previewRendererChecks },
  );
  verifyUx(
    "preview renderer subtrees are keyboard-inert",
    (await page.locator(".artifact-preview-node:not([inert])").count()) === 0,
  );
  verifyUx(
    "offscreen preview renderers release outside the library scroll neighborhood",
    (await page.getByTestId("artifact-preview-metric-card").getAttribute("data-preview-ready")) === "false",
  );
  await showProofStep(page, "Preview gallery • Probability and Allocation stay fully visible", 1300);
  await showProofStep(page, "Artifact Library • switch from Built-in to Yours", 850);
  await page.getByTestId("artifact-tab-personal").click();
  const personalLibraryItem = page.getByTestId("artifact-library-item-agent-capacity-card");
  await personalLibraryItem.waitFor({ state: "visible" });
  verifyUx("deleted personal card remains available under Yours", await personalLibraryItem.isVisible());
  const personalPreviewGeometry = await artifactPreviewGeometry(page, "agent-capacity-card");
  verifyUx(
    "personal package receives the same complete real-renderer preview",
    Boolean(personalPreviewGeometry?.contained && await page.getByTestId("preview-echarts-agent-capacity-card").locator("svg").count()),
    { personalPreviewGeometry },
  );

  await showProofStep(page, "Drag from Yours • place the saved artifact back on this canvas", 900);
  await personalLibraryItem.dragTo(stage, { targetPosition: { x: 620, y: 360 } });
  await page.waitForFunction(() => window.__FREEFORM_STATE__.nodes.some((node) => node.artifactId === "agent-capacity-card"));
  const restoredPersonalNode = (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.find((node) => node.artifactId === "agent-capacity-card");
  if (!restoredPersonalNode) throw new Error("Personal artifact did not return from the library");
  installedArtifact = { ...installedArtifact, nodeId: restoredPersonalNode.id };
  verifyUx("personal artifact can be dragged back after node deletion", await page.getByTestId(`node-${restoredPersonalNode.id}`).isVisible(), { restoredPersonalNode });
  verifyUx("re-added personal artifact keeps its generated content", await page.getByText("Installed directly into this view").isVisible());

  await showProofStep(page, "Delete built-in card • recover it from Built-in", 650);
  await page.getByTestId("node-node-revenue").click({ position: { x: 100, y: 18 } });
  const beforeDelete = await page.evaluate(() => window.__FREEFORM_STATE__);
  await page.getByTestId("delete-node-revenue").click();
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.status === "Saved locally");
  await page.waitForTimeout(450);
  const afterDelete = await page.evaluate(() => window.__FREEFORM_STATE__);
  verifyUx("delete control removes exactly the selected artifact", afterDelete.nodes.length === beforeDelete.nodes.length - 1 && !afterDelete.nodes.some((node) => node.id === "node-revenue"), {
    beforeCount: beforeDelete.nodes.length,
    afterCount: afterDelete.nodes.length,
  });
  await page.keyboard.press("Meta+Shift+a");
  await page.getByTestId("artifact-tab-built-in").click();
  await showProofStep(page, "Built-in library • restore Metric summary with one click", 900);
  await page.getByTestId("artifact-library-item-metric-card").click();
  await page.waitForFunction(() => window.__FREEFORM_STATE__.nodes.some((node) => node.artifactId === "metric-card"));
  const restoredMetricNode = (await page.evaluate(() => window.__FREEFORM_STATE__)).nodes.find((node) => node.artifactId === "metric-card");
  if (!restoredMetricNode) throw new Error("Built-in metric did not return from the library");
  verifyUx("built-in artifact can be restored after node deletion", restoredMetricNode.id !== "node-revenue", { restoredMetricNode });
  const restoredMetricVisibility = await page.getByTestId(`node-${restoredMetricNode.id}`).evaluate((node) => {
    const nodeRect = node.getBoundingClientRect();
    const stageRect = document.querySelector('[data-testid="canvas-stage"]')?.getBoundingClientRect();
    if (!stageRect) return null;
    return {
      left: nodeRect.left >= stageRect.left - 1,
      right: nodeRect.right <= stageRect.right + 1,
      top: nodeRect.top >= stageRect.top - 1,
      bottom: nodeRect.bottom <= stageRect.bottom + 1,
    };
  });
  verifyUx(
    "click placement keeps the restored artifact inside the current viewport",
    Boolean(restoredMetricVisibility && Object.values(restoredMetricVisibility).every(Boolean)),
    { restoredMetricVisibility },
  );
  await showProofStep(page, "Click placement • restored artifact stays in the visible canvas", 900);
  await page.waitForFunction(() => window.__FREEFORM_STATE__?.status === "Saved locally");
  await page.waitForTimeout(650);

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
  verifyUx("reload preserves deletion of the original built-in node", !restoredState.nodes.some((node) => node.id === "node-revenue"));
  verifyUx("reload restores the library-readded built-in artifact", restoredState.nodes.some((node) => node.id === restoredMetricNode.id));
  verifyUx("reload restores the agent-installed artifact", restoredState.nodes.some((node) => node.id === installedArtifact.nodeId) && restoredState.artifactIds.includes("agent-capacity-card"));
  const restoredViews = await page.evaluate(() => window.__FREEFORM_AGENT__.listViews());
  verifyUx("reload restores multiple named views", restoredViews.some((view) => view.title === "Market canvas") && restoredViews.some((view) => view.title === "Scenario canvas"), { restoredViews });
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
      "rename the centered canvas title",
      "toggle Views with Cmd+B",
      "open the sidebar, create and rename a second view, and switch back",
      "drag node",
      "visibly resize the complete chart object",
      "visibly resize Sankey to its proportional minimum",
      "drag-pan canvas",
      "wheel pan",
      "pinch zoom in and out around a stable pointer anchor",
      "toolbar zoom and viewport reset",
      "import query result",
      "toggle dark mode",
      "generate and copy a no-code artifact bundle handoff",
      "install a runtime artifact through the browser Agent API",
      "reject an invalid Chart Kit artifact before persistence",
      "delete and drag a personal artifact back from the shared library",
      "delete and restore a built-in artifact from the library",
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
