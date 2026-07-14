import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const appUrl = process.env.FREEFORM_PRODUCTION_URL ?? "https://siriusctrl.github.io/freeform-artifacts/";
const expectedRelay = "https://freeform-artifact-relay.morryniu123.workers.dev";
const artifactId = "production-relay-smoke";
const securitySmokeOnly = process.argv.includes("--security-smoke");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "freeform-relay-smoke-"));
const bundlePath = path.join(temporaryDirectory, `${artifactId}.freeform-artifact.json`);
let browser;
let context;
let page;
let liveSessionMayExist = false;

async function waitFor(predicate, timeoutMs, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failureMessage);
}

async function verifyRelayEdgeSecurity() {
  const productionOrigin = new URL(appUrl).origin;
  const healthResponse = await fetch(`${expectedRelay}/health?probe=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  const health = await healthResponse.json();
  if (!healthResponse.ok || !health.ok || !health.ready || health.version !== 2 || health.enabled !== true) {
    throw new Error(`Relay health check failed: ${JSON.stringify(health)}`);
  }

  const allowedPreflight = await fetch(`${expectedRelay}/v1/sessions`, {
    method: "OPTIONS",
    headers: {
      Origin: productionOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (allowedPreflight.status !== 204 || allowedPreflight.headers.get("Access-Control-Allow-Origin") !== productionOrigin) {
    throw new Error("Relay did not allow the production Pages origin");
  }
  const allowedMethods = allowedPreflight.headers.get("Access-Control-Allow-Methods")
    ?.split(",").map((value) => value.trim().toUpperCase()) ?? [];
  const allowedHeaders = allowedPreflight.headers.get("Access-Control-Allow-Headers")
    ?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  const variedHeaders = allowedPreflight.headers.get("Vary")
    ?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (!allowedMethods.includes("POST") || !allowedHeaders.includes("content-type") || !variedHeaders.includes("origin")) {
    throw new Error("Relay production CORS preflight omitted required method, header, or cache variance");
  }

  const deniedPreflight = await fetch(`${expectedRelay}/v1/sessions`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://relay-smoke.invalid",
      "Access-Control-Request-Method": "POST",
    },
  });
  if (deniedPreflight.status !== 403 || deniedPreflight.headers.has("Access-Control-Allow-Origin")) {
    throw new Error("Relay did not fail closed for a foreign origin");
  }
  const deniedPost = await fetch(`${expectedRelay}/v1/sessions`, {
    method: "POST",
    headers: {
      Origin: "https://relay-smoke.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (deniedPost.status !== 403 || deniedPost.headers.has("Access-Control-Allow-Origin")) {
    throw new Error("Relay accepted or exposed a foreign-origin session request");
  }

  return health;
}

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
    targetViewIncarnationId: option("view-incarnation-id"),
  };
}

function runDelivery(session) {
  const args = [
    path.join(root, "skill/freeform-artifact-builder/scripts/deliver.mjs"),
    "--relay-url", session.endpoint,
    "--session-id", session.sessionId,
    "--credentials-stdin",
    "--view-id", session.targetViewId,
    "--view-incarnation-id", session.targetViewIncarnationId,
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

async function endLiveSession() {
  if (!page || !liveSessionMayExist) return;
  const endButton = page.getByRole("button", { name: "End session", exact: true });
  await endButton.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {
    throw new Error("Production session could not be ended explicitly");
  });
  const deletion = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "DELETE" &&
      url.origin === expectedRelay &&
      /^\/v1\/sessions\/[^/]+$/.test(url.pathname);
  }, { timeout: 15_000 });
  await endButton.click();
  const response = await deletion;
  if (response.status() !== 204) throw new Error(`Production session cleanup failed with ${response.status()}`);
  liveSessionMayExist = false;
}

try {
  const health = await verifyRelayEdgeSecurity();

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
  context = await browser.newContext();
  page = await context.newPage();
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async (value) => { clipboardText = String(value); },
      },
    });
  });
  const turnstileEvidence = {
    apiScriptLoaded: false,
    challengeStarted: false,
    frameObserved: false,
  };
  let sessionCreationRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url() === `${expectedRelay}/v1/sessions`) {
      sessionCreationRequests += 1;
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() === "POST" &&
      response.url() === `${expectedRelay}/v1/sessions` &&
      response.status() === 201
    ) {
      liveSessionMayExist = true;
    }
    if (url.hostname !== "challenges.cloudflare.com" || !response.ok()) return;
    if (url.pathname.includes("/turnstile/") && url.pathname.endsWith("/api.js")) {
      turnstileEvidence.apiScriptLoaded = true;
    }
    if (url.pathname.includes("/cdn-cgi/challenge-platform/")) {
      turnstileEvidence.challengeStarted = true;
    }
  });
  page.on("framenavigated", (frame) => {
    try {
      if (new URL(frame.url()).hostname === "challenges.cloudflare.com") {
        turnstileEvidence.frameObserved = true;
      }
    } catch {
      // Initial about:blank frames are not URL evidence.
    }
  });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  await waitFor(
    () => turnstileEvidence.apiScriptLoaded && (turnstileEvidence.challengeStarted || turnstileEvidence.frameObserved),
    20_000,
    "The production Turnstile widget did not start",
  );

  if (securitySmokeOnly) {
    const copyEnabled = await page.getByTestId("copy-agent-instruction").isEnabled();
    const status = await page.getByTestId("relay-session-status").innerText();
    const instruction = await page.getByTestId("agent-instruction").textContent() ?? "";
    if (
      !copyEnabled ||
      sessionCreationRequests !== 0 ||
      !status.includes("Checking this browser") ||
      !instruction.includes("Delivery mode: BROWSER_VIEW_BUNDLE") ||
      instruction.includes("--credentials-stdin") ||
      instruction.includes('"uploadToken"') ||
      instruction.includes('"encryptionKey"')
    ) {
      throw new Error("The production client did not keep authoring available and upload capabilities fail-closed before human verification");
    }
    console.log(JSON.stringify({
      ok: true,
      mode: "automated-security-smoke",
      appUrl,
      relayUrl: expectedRelay,
      relayVersion: health.version,
      turnstile: "started; human verification required for a full delivery",
      sessionCreationRequests,
    }, null, 2));
  } else {
    try {
      await page.getByTestId("relay-session-status").getByText("Live delivery ready", { exact: true }).waitFor({
        state: "visible",
        timeout: 180_000,
      });
    } catch (error) {
      const status = await page.getByTestId("relay-session-status").innerText().catch(() => "missing status");
      throw new Error(`Human-verified production Build Session did not become ready. Status: ${status}. ${error instanceof Error ? error.message : ""}`);
    }
    await page.getByTestId("copy-agent-instruction").click();
    const session = parseRelayHandoff(await page.evaluate(() => navigator.clipboard.readText()));
    if (
      !session ||
      session.endpoint !== expectedRelay ||
      session.targetViewId !== "market-overview" ||
      !session.targetViewIncarnationId
    ) {
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
    await endLiveSession();
    await page.getByText("Real Turnstile and workers.dev delivery").waitFor({ state: "visible" });
    const installed = await page.evaluate((id) => window.__FREEFORM_STATE__?.artifactIds.includes(id), artifactId);
    if (!installed) throw new Error("Production browser did not persist the relay artifact");

    console.log(JSON.stringify({
      ok: true,
      mode: "human-verified-full-journey",
      appUrl,
      relayUrl: expectedRelay,
      targetViewId: session.targetViewId,
      artifactId,
      deliveryId: delivery.deliveryId,
    }, null, 2));
  }
} finally {
  if (liveSessionMayExist) await endLiveSession().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
