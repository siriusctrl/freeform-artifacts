import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo, type WebSocketRoute } from "@playwright/test";
import { agentArtifactBundle } from "./helpers/runtimeBundle";
import { stubTurnstile } from "./helpers/relay";

interface BrowserRelaySession {
  endpoint: string;
  sessionId: string;
  uploadToken: string;
  encryptionKey: string;
  expiresAt: string;
  targetViewId: string;
  targetViewTitle: string;
}

const DELIVERY_SCRIPT = path.resolve("skill/freeform-artifact-builder/scripts/deliver.mjs");

test.describe.configure({ mode: "serial" });

async function openBuildSession(page: Page) {
  await stubTurnstile(page);
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Relay connected");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4177" });
  await page.getByTestId("copy-agent-instruction").click();
  const handoff = await page.evaluate(() => navigator.clipboard.readText());
  const option = (name: string) => handoff.match(new RegExp(`--${name}\\s+"([^"]+)"`))?.[1];
  const credentialsLine = handoff.split("\n").find((line) => line.startsWith('{"uploadToken"'));
  const credentials = credentialsLine ? JSON.parse(credentialsLine) as { uploadToken: string; encryptionKey: string } : null;
  const session: BrowserRelaySession = {
    endpoint: option("relay-url") ?? "",
    sessionId: option("session-id") ?? "",
    uploadToken: credentials?.uploadToken ?? "",
    encryptionKey: credentials?.encryptionKey ?? "",
    expiresAt: handoff.match(/Session expires at (.+)\.$/m)?.[1] ?? "",
    targetViewId: handoff.match(/^Target Freeform view id: (.+)$/m)?.[1] ?? "",
    targetViewTitle: handoff.match(/^Target Freeform view title: (.+)$/m)?.[1] ?? "",
  };
  expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(session.uploadToken).toHaveLength(43);
  expect(session.encryptionKey).toHaveLength(43);
  expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
  return session;
}

async function runDelivery(
  testInfo: TestInfo,
  session: BrowserRelaySession,
  bundles: ReturnType<typeof agentArtifactBundle>[],
  deliveryId?: string,
) {
  const paths: string[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const file = testInfo.outputPath(`${bundle.artifactId}-${index}.freeform-artifact.json`);
    await writeFile(file, JSON.stringify(bundle), "utf8");
    paths.push(file);
  }
  const args = [
    DELIVERY_SCRIPT,
    "--relay-url", session.endpoint,
    "--session-id", session.sessionId,
    "--credentials-stdin",
    "--view-id", session.targetViewId,
  ];
  if (deliveryId) args.push("--delivery-id", deliveryId);
  args.push(...paths);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FREEFORM_RELAY_CACHE_DIR: testInfo.outputPath("relay-cache") },
    });
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`Delivery script failed: ${output || stderr || `exit ${code}`}`));
      else resolve(output);
    });
    child.stdin.end(`${JSON.stringify({ uploadToken: session.uploadToken, encryptionKey: session.encryptionKey })}\n`);
  });
  return JSON.parse(stdout) as {
    accepted: boolean;
    artifactIds: string[];
    deliveryId: string;
    duplicate: boolean;
    targetViewId: string;
  };
}

async function readArtifactPackage(page: Page, artifactId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction("artifact-packages", "readonly").objectStore("artifact-packages").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, artifactId);
}

test("one session accepts atomic, repeated, and multi-tab-safe deliveries", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  expect(session.targetViewId).toBe("market-overview");
  const displayedInstruction = await page.getByTestId("agent-instruction").innerText();
  expect(displayedInstruction).toContain("--credentials-stdin");
  expect(displayedInstruction).toContain("<hidden-upload-capability>");
  expect(displayedInstruction).not.toContain(session.uploadToken);
  expect(displayedInstruction).not.toContain(session.encryptionKey);
  await page.getByTestId("copy-agent-instruction").click();
  const copiedInstruction = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedInstruction).toContain(session.uploadToken);
  expect(copiedInstruction).toContain(session.encryptionKey);
  expect(copiedInstruction).not.toContain("--upload-token");
  expect(copiedInstruction).not.toContain("--encryption-key");
  const first = agentArtifactBundle("relay-capacity-card");
  const second = agentArtifactBundle("relay-outlook-card");
  const initialNodes = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes);

  const accepted = await runDelivery(testInfo, session, [first, second]);
  expect(accepted).toMatchObject({
    accepted: true,
    duplicate: false,
    artifactIds: [first.artifactId, second.artifactId],
    targetViewId: "market-overview",
  });
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 2 artifacts");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialNodes.length + 2);

  const deliveredNodes = await page.evaluate((ids) =>
    window.__FREEFORM_STATE__!.nodes.filter((node) => ids.includes(node.artifactId)),
  [first.artifactId, second.artifactId]);
  expect(deliveredNodes).toHaveLength(2);
  expect(deliveredNodes.every((node) => node.x % 38 === 0 && node.y % 38 === 0)).toBe(true);
  expect(deliveredNodes[0].zIndex).toBeGreaterThan(Math.max(...initialNodes.map((node) => node.zIndex)));
  expect(deliveredNodes[1].zIndex).toBeGreaterThan(deliveredNodes[0].zIndex);

  const followup = agentArtifactBundle("relay-followup-card");
  const rapidFollowup = agentArtifactBundle("relay-rapid-followup-card");
  await Promise.all([
    runDelivery(testInfo, session, [followup]),
    runDelivery(testInfo, session, [rapidFollowup]),
  ]);
  await expect.poll(async () => page.evaluate((ids) => ids.every((id) => window.__FREEFORM_STATE__?.artifactIds.includes(id) ?? false), [
    followup.artifactId,
    rapidFollowup.artifactId,
  ])).toBe(true);

  const sibling = await page.context().newPage();
  await sibling.goto("/");
  await sibling.getByTestId("canvas-stage").waitFor({ state: "visible" });
  const siblingRevenue = sibling.getByTestId("node-node-revenue");
  const siblingRevenueBox = await siblingRevenue.boundingBox();
  expect(siblingRevenueBox).not.toBeNull();
  const siblingRevenueBefore = await sibling.evaluate(() =>
    window.__FREEFORM_STATE__!.nodes.find((node) => node.id === "node-revenue")!.x);
  await sibling.mouse.move(siblingRevenueBox!.x + 90, siblingRevenueBox!.y + 18);
  await sibling.mouse.down();
  await sibling.mouse.move(siblingRevenueBox!.x + 166, siblingRevenueBox!.y + 56, { steps: 8 });
  await sibling.mouse.up();
  await expect.poll(async () => sibling.evaluate(() =>
    window.__FREEFORM_STATE__!.nodes.find((node) => node.id === "node-revenue")!.x)).not.toBe(siblingRevenueBefore);
  await expect.poll(async () => sibling.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
  const siblingRevenueX = await sibling.evaluate(() =>
    window.__FREEFORM_STATE__!.nodes.find((node) => node.id === "node-revenue")!.x);
  const multiTab = agentArtifactBundle("relay-multitab-card");
  await runDelivery(testInfo, session, [multiTab]);
  await expect.poll(async () => page.evaluate((expected) => ({
    installed: window.__FREEFORM_STATE__!.artifactIds.includes(expected.artifactId),
    revenueX: window.__FREEFORM_STATE__!.nodes.find((node) => node.id === "node-revenue")!.x,
  }), { artifactId: multiTab.artifactId, revenueX: siblingRevenueX })).toEqual({
    installed: true,
    revenueX: siblingRevenueX,
  });
  await sibling.close();
  await page.waitForTimeout(350);
  const sessionId = session.sessionId;
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Relay connected");
  await page.getByTestId("copy-agent-instruction").click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).includes(sessionId)).toBe(true);
  await page.getByTitle("Close", { exact: true }).click();
  await page.reload();
  await expect.poll(async () => page.evaluate((ids) => ids.every((id) => window.__FREEFORM_STATE__?.artifactIds.includes(id) ?? false), [
    followup.artifactId,
    rapidFollowup.artifactId,
  ])).toBe(true);
  await expect.poll(async () => page.evaluate((ids) => {
    const delivered = window.__FREEFORM_STATE__!.nodes.filter((node) => ids.includes(node.artifactId));
    return new Set(delivered.map((node) => node.artifactId)).size;
  }, [followup.artifactId, rapidFollowup.artifactId])).toBe(2);
  expect(await page.evaluate((expected) => ({
    installed: window.__FREEFORM_STATE__!.artifactIds.includes(expected.artifactId),
    revenueX: window.__FREEFORM_STATE__!.nodes.find((node) => node.id === "node-revenue")!.x,
  }), { artifactId: multiTab.artifactId, revenueX: siblingRevenueX })).toEqual({
    installed: true,
    revenueX: siblingRevenueX,
  });
  await page.waitForTimeout(300);
  await expect(runDelivery(testInfo, session, [agentArtifactBundle("relay-after-reload")])).rejects.toThrow("session_expired");
});

test("host placement falls back to centered, grid-offset stacking when no card fits the viewport", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  const makeOversized = (artifactId: string) => {
    const bundle = agentArtifactBundle(artifactId);
    return {
      ...bundle,
      moduleSource: bundle.moduleSource.replace(
        "defaultSize: { width: 480, height: 300 }",
        "defaultSize: { width: 2000, height: 1400 }",
      ),
    };
  };
  const first = makeOversized("relay-oversized-one");
  const second = makeOversized("relay-oversized-two");
  const expected = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    const rect = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const centerX = (rect.width / 2 - state.viewport.x) / state.viewport.scale;
    const centerY = (rect.height / 2 - state.viewport.y) / state.viewport.scale;
    return {
      x: Math.round(Math.round(centerX - 1_000) / 38) * 38,
      y: Math.round(Math.round(centerY - 700) / 38) * 38,
    };
  });
  await runDelivery(testInfo, session, [first, second]);
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 2 artifacts");
  const nodes = await page.evaluate((ids) =>
    window.__FREEFORM_STATE__!.nodes.filter((node) => ids.includes(node.artifactId)),
  [first.artifactId, second.artifactId]);
  expect(nodes.map(({ x, y }) => ({ x, y }))).toEqual([
    expected,
    { x: expected.x + 38, y: expected.y + 38 },
  ]);
  expect(nodes[1].zIndex).toBeGreaterThan(nodes[0].zIndex);
});

test("a bad artifact rejects the complete multi-artifact delivery atomically", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  const valid = agentArtifactBundle("relay-atomic-valid");
  const invalid = {
    ...agentArtifactBundle("relay-atomic-invalid"),
    moduleSource: `export const artifact = {
      id: "relay-atomic-invalid", renderer: "chart-kit", title: "Invalid",
      version: "1.0.0", defaultSize: { width: 420, height: 260 },
      buildChart: () => ({ kind: "cartesian", categories: ["Q1", "Q2"],
        series: [{ id: "value", name: "Value", type: "bar", values: [1] }] }),
    };`,
  };
  const initialCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  const accepted = await runDelivery(testInfo, session, [valid, invalid]);
  expect(accepted.accepted).toBe(true);
  await expect(page.getByTestId("relay-session-status")).toContainText("Delivery rejected");
  await expect(page.getByTestId("relay-session-status")).toContainText("category count");
  await expect(page.getByTestId("relay-session-status")).toContainText("Nothing was installed");
  expect(await readArtifactPackage(page, valid.artifactId)).toBeUndefined();
  expect(await readArtifactPackage(page, invalid.artifactId)).toBeUndefined();
  expect(await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount);
});

test("an ACK lost after commit replays the receipt without installing a duplicate node", async ({ page, context }, testInfo) => {
  let dropNextAck = true;
  let resolveDroppedAck: () => void = () => {};
  const droppedAck = new Promise<void>((resolve) => {
    resolveDroppedAck = resolve;
  });
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (dropNextAck && typeof message === "string" && message.includes('"type":"ack"')) {
        dropNextAck = false;
        resolveDroppedAck();
        socket.close({ code: 1012, reason: "Drop ACK after local commit" });
        return;
      }
      server.send(message);
    });
  });
  const session = await openBuildSession(page);
  const bundle = agentArtifactBundle("relay-ack-loss-card");
  const initialCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  await runDelivery(testInfo, session, [bundle]);
  await droppedAck;
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 1 artifact", { timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 1);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 1);
});

test("a session remains bound to its original view after navigation", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).not.toBe(session.targetViewId);
  const otherViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  expect(otherViewId).not.toBe(session.targetViewId);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);

  const bundle = agentArtifactBundle("relay-bound-view-card");
  await runDelivery(testInfo, session, [bundle]);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);
  await page.getByTestId(`view-${session.targetViewId}`).click();
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), bundle.artifactId)).toBe(true);
  await expect(page.getByText("Installed without a deploy")).toBeVisible();
});

test("a pending encrypted delivery is replayed after the browser reconnects", async ({ page, context }, testInfo) => {
  let blockConnections = false;
  let browserSocket: WebSocketRoute | null = null;
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    browserSocket = socket;
    if (blockConnections) {
      socket.close({ code: 1012, reason: "Playwright interruption" });
      return;
    }
    socket.connectToServer();
  });
  const session = await openBuildSession(page);
  expect(browserSocket).not.toBeNull();
  blockConnections = true;
  (browserSocket as WebSocketRoute | null)?.close({ code: 1012, reason: "Playwright interruption" });
  await expect(page.getByTestId("relay-session-status")).toContainText("Reconnecting");
  const bundle = agentArtifactBundle("relay-reconnect-card");
  const accepted = await runDelivery(testInfo, session, [bundle]);
  expect(accepted.duplicate).toBe(false);
  blockConnections = false;
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 1 artifact", { timeout: 15_000 });
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), bundle.artifactId)).toBe(true);
});

test("an expired session clears stale copy feedback and its browser handoff", async ({ page, context }) => {
  let browserSocket: WebSocketRoute | null = null;
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    browserSocket = socket;
    socket.connectToServer();
  });
  const session = await openBuildSession(page);
  await expect(page.getByTestId("copy-agent-instruction")).toContainText("Copied");
  expect(browserSocket).not.toBeNull();
  (browserSocket as WebSocketRoute | null)?.send(JSON.stringify({ version: 1, type: "expired" }));
  await expect(page.getByTestId("relay-session-status")).toContainText("Expired");
  await expect(page.getByTestId("copy-agent-instruction")).toBeDisabled();
  await expect(page.getByTestId("copy-agent-instruction")).toContainText("Copy instruction");
  await expect(page.getByTestId("copy-agent-instruction")).not.toContainText("Copied");
  await expect(page.getByTestId("agent-instruction")).not.toContainText(session.uploadToken);
});

test("session creation failure can be retried and a stale target cannot win the creation race", async ({ page }) => {
  await stubTurnstile(page);
  let creationAttempt = 0;
  let releaseStaleCreation!: () => void;
  const staleCreationGate = new Promise<void>((resolve) => { releaseStaleCreation = resolve; });
  await page.route(/\/v1\/sessions$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    creationAttempt += 1;
    const corsHeaders = { "Access-Control-Allow-Origin": "http://127.0.0.1:4177", Vary: "Origin" };
    if (creationAttempt === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({ error: "temporarily_unavailable" }),
      });
      return;
    }
    if (creationAttempt === 2) {
      const request = route.request().postDataJSON() as { targetViewId: string };
      await staleCreationGate;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({
          version: 1,
          sessionId: crypto.randomUUID(),
          targetViewId: request.targetViewId,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        }),
      }).catch(() => undefined);
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Needs attention");
  await expect(page.getByTestId("relay-session-status")).toContainText("Build Sessions are temporarily unavailable. Try again shortly.");
  await expect(page.getByTestId("relay-session-status")).not.toContainText("temporarily_unavailable");
  await page.getByRole("button", { name: "Retry verification" }).click();
  await expect.poll(() => creationAttempt).toBe(2);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).not.toBe("market-overview");
  const latestViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  expect(latestViewId).not.toBe("market-overview");
  await page.getByTestId("build-artifact").click();
  try {
    await expect.poll(() => creationAttempt, { timeout: 2_000 }).toBe(3);
  } finally {
    releaseStaleCreation();
  }
  await expect(page.getByTestId("relay-session-status")).toContainText("Relay connected");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await expect(page.getByTestId("agent-instruction")).toContainText(`Target Freeform view id: ${latestViewId}`);
});

test("ending a session cancels in-flight work and a reload exposes no capability", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  const slow = agentArtifactBundle("relay-cancelled-in-flight");
  slow.moduleSource = `window.__relaySlowInstallStarted = true;
await new Promise((resolve) => setTimeout(resolve, 1200));
${slow.moduleSource}`;
  await runDelivery(testInfo, session, [slow]);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __relaySlowInstallStarted?: boolean }).__relaySlowInstallStarted))).toBe(true);
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Build with AI" })).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(await page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), slow.artifactId)).toBe(false);
  expect(await readArtifactPackage(page, slow.artifactId)).toBeUndefined();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes("relay")))).toEqual([]);
  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes("relay")))).toEqual([]);
  await expect(page.getByTestId("relay-session-status")).toHaveCount(0);
  expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
});

test("an ambiguous uploader failure reports the reusable delivery id", async ({}, testInfo) => {
  let requestCount = 0;
  let acceptRetry = false;
  const uploadedEnvelopes: string[] = [];
  const server = createServer((request, response) => {
    let source = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { source += chunk; });
    request.once("end", () => {
      requestCount += 1;
      uploadedEnvelopes.push(source);
      if (acceptRetry) {
        const delivery = JSON.parse(source) as { deliveryId: string };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ accepted: true, duplicate: true, deliveryId: delivery.deliveryId }));
        return;
      }
      if (requestCount === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(410, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "session_expired" }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Uploader test server did not bind a TCP port");
  const bundle = agentArtifactBundle("relay-ambiguous-outcome");
  const bundlePath = testInfo.outputPath("ambiguous.freeform-artifact.json");
  const sessionId = crypto.randomUUID();
  const uploadToken = "A".repeat(43);
  const encryptionKey = "B".repeat(43);
  const cacheBase = testInfo.outputPath("relay-cache");
  await writeFile(bundlePath, JSON.stringify(bundle), "utf8");
  const args = [
    DELIVERY_SCRIPT,
    "--relay-url", `http://127.0.0.1:${address.port}`,
    "--session-id", sessionId,
    "--credentials-stdin",
    "--view-id", "market-overview",
    bundlePath,
  ];
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, FREEFORM_RELAY_CACHE_DIR: cacheBase },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(`${JSON.stringify({ uploadToken, encryptionKey })}\n`);
    });
    expect(result.code).not.toBe(0);
    const failure = JSON.parse(result.stdout) as { outcome: string; deliveryId: string; artifactIds: string[] };
    expect(failure).toMatchObject({ outcome: "unknown", artifactIds: [bundle.artifactId] });
    expect(failure.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.stderr).toContain(`--delivery-id ${failure.deliveryId}`);
    const retryCachePath = path.join(
      cacheBase,
      "freeform-artifacts",
      "relay-deliveries",
      sessionId,
      `${failure.deliveryId}.json`,
    );
    const retryCache = await readFile(retryCachePath, "utf8");
    expect(retryCache).not.toContain(uploadToken);
    expect(retryCache).not.toContain(encryptionKey);
    expect((await stat(retryCachePath)).mode & 0o777).toBe(0o600);

    acceptRetry = true;
    const retryArgs = [...args];
    retryArgs.splice(retryArgs.length - 1, 0, "--delivery-id", failure.deliveryId);
    const retry = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, retryArgs, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, FREEFORM_RELAY_CACHE_DIR: cacheBase },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(`${JSON.stringify({ uploadToken, encryptionKey })}\n`);
    });
    expect(retry.code).toBe(0);
    expect(JSON.parse(retry.stdout)).toMatchObject({ accepted: true, duplicate: true, deliveryId: failure.deliveryId });
    expect(uploadedEnvelopes.at(-1)).toBe(uploadedEnvelopes[0]);
    await expect(stat(retryCachePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
