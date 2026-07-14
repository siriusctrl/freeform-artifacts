import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const appUrl = process.env.FREEFORM_PRODUCTION_URL ?? "https://siriusctrl.github.io/freeform-artifacts/";
const expectedRelay = "https://freeform-artifact-relay.morryniu123.workers.dev";
const artifactId = "production-relay-smoke";
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "freeform-relay-smoke-"));
const bundlePath = path.join(temporaryDirectory, `${artifactId}.freeform-artifact.json`);
let browser;

function parseRelayHandoff(handoff) {
  const option = (name) => handoff.match(new RegExp(`--${name}\\s+"([^"]+)"`))?.[1];
  const credentialsLine = handoff.split("\n").find((line) => line.startsWith('{"uploadToken"'));
  const credentials = credentialsLine ? JSON.parse(credentialsLine) : {};
  return {
    endpoint: option("relay-url"),
    sessionId: option("session-id"),
    uploadToken: credentials.uploadToken,
    encryptionKey: credentials.encryptionKey,
    targetViewId: option("view-id"),
  };
}

function runDelivery(session) {
  const args = [
    path.join(root, "skill/freeform-artifact-builder/scripts/deliver.mjs"),
    "--relay-url", session.endpoint,
    "--session-id", session.sessionId,
    "--credentials-stdin",
    "--view-id", session.targetViewId,
    bundlePath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `Delivery process exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
    child.stdin.end(`${JSON.stringify({ uploadToken: session.uploadToken, encryptionKey: session.encryptionKey })}\n`);
  });
}

try {
  const health = await fetch(`${expectedRelay}/health`).then((response) => response.json());
  if (!health.ok || health.version !== 1 || health.enabled !== true) {
    throw new Error(`Relay health check failed: ${JSON.stringify(health)}`);
  }

  await writeFile(bundlePath, JSON.stringify({
    version: 1,
    artifactId,
    moduleSource: `export const artifact = {
      id: "production-relay-smoke", renderer: "chart-kit", title: "Production Relay Smoke",
      version: "1.0.0", defaultSize: { width: 480, height: 300 },
      buildChart: ({ data }) => ({ kind: "cartesian", title: data.title,
        categories: data.points.map((point) => point.label),
        series: [{ id: "value", name: "Value", type: "bar", values: data.points.map((point) => point.value) }] }),
    };`,
    node: {
      title: "Production relay smoke",
      data: { title: "Real Turnstile and workers.dev delivery", points: [{ label: "Ready", value: 1 }, { label: "Installed", value: 2 }] },
      config: {},
    },
  }), "utf8");

  browser = await chromium.launch({ headless: process.env.FREEFORM_HEADLESS !== "false" });
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(appUrl).origin });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  try {
    await page.getByTestId("relay-session-status").getByText("Relay connected", { exact: true }).waitFor({
      state: "visible",
      timeout: 60_000,
    });
  } catch (error) {
    const status = await page.getByTestId("relay-session-status").innerText().catch(() => "missing status");
    const turnstileFrames = page.frames().filter((frame) => frame.url().includes("challenges.cloudflare.com")).length;
    throw new Error(`Production Build Session did not become ready. Status: ${status}. Turnstile frames: ${turnstileFrames}. ${error instanceof Error ? error.message : ""}`);
  }
  await page.getByTestId("copy-agent-instruction").click();
  const session = parseRelayHandoff(await page.evaluate(() => navigator.clipboard.readText()));
  if (!session || session.endpoint !== expectedRelay || session.targetViewId !== "market-overview") {
    throw new Error("Production Build Session did not bind the expected relay and view");
  }

  const delivery = await runDelivery(session);
  if (!delivery.accepted || delivery.artifactIds?.[0] !== artifactId) {
    throw new Error("Production relay did not accept the smoke artifact");
  }
  await page.getByTestId("relay-session-status").getByText("Installed 1 artifact", { exact: false }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByText("Real Turnstile and workers.dev delivery").waitFor({ state: "visible" });
  const installed = await page.evaluate((id) => window.__FREEFORM_STATE__?.artifactIds.includes(id), artifactId);
  if (!installed) throw new Error("Production browser did not persist the relay artifact");

  console.log(JSON.stringify({
    ok: true,
    appUrl,
    relayUrl: expectedRelay,
    targetViewId: session.targetViewId,
    artifactId,
    deliveryId: delivery.deliveryId,
  }, null, 2));
  await context.close();
} finally {
  await browser?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
