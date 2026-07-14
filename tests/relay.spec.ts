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
  targetViewIncarnationId: string;
  targetViewTitle: string;
}

const DELIVERY_SCRIPT = path.resolve("skill/freeform-artifact-builder/scripts/deliver.mjs");

test.describe.configure({ mode: "serial" });

interface PositionedNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nodesOverlapWithGap(left: PositionedNode, right: PositionedNode, gap = 0) {
  return left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y;
}

async function openBuildSession(page: Page) {
  await stubTurnstile(page);
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
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
    targetViewIncarnationId: option("view-incarnation-id") ?? "",
    targetViewTitle: handoff.match(/^Target Freeform view title: (.+)$/m)?.[1] ?? "",
  };
  expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(session.uploadToken).toHaveLength(43);
  expect(session.encryptionKey).toHaveLength(43);
  expect(session.targetViewIncarnationId).not.toBe("");
  expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
  await expect(page.getByTestId("artifact-bundle-file")).toHaveAttribute("tabindex", "-1");
  await expect(page.getByTestId("workspace-file")).toHaveAttribute("tabindex", "-1");
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
    "--view-incarnation-id", session.targetViewIncarnationId,
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

async function readWorkspaceTitle(page: Page, workspaceId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const request = database.transaction("workspaces", "readonly").objectStore("workspaces").get(id);
        request.onsuccess = () => {
          const value = request.result as { title?: unknown } | undefined;
          resolve(typeof value?.title === "string" ? value.title : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, workspaceId);
}

async function readWorkspaceIncarnation(page: Page, workspaceId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const request = database.transaction("workspaces", "readonly").objectStore("workspaces").get(id);
        request.onsuccess = () => {
          const value = request.result as { incarnationId?: unknown } | undefined;
          resolve(typeof value?.incarnationId === "string" ? value.incarnationId : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, workspaceId);
}

test("one session accepts atomic, repeated, and multi-tab-safe deliveries", async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  const session = await openBuildSession(page);
  expect(session.targetViewId).toBe("market-overview");
  const displayedInstruction = await page.getByTestId("agent-instruction").textContent() ?? "";
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
  const deliveryBounds = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    const rect = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    return {
      left: -state.viewport.x / state.viewport.scale,
      right: (rect.width - state.viewport.x) / state.viewport.scale,
      top: -state.viewport.y / state.viewport.scale,
      bottom: (rect.height - state.viewport.y) / state.viewport.scale,
    };
  });
  for (const delivered of deliveredNodes) {
    expect(delivered.x + delivered.width).toBeGreaterThan(deliveryBounds.left);
    expect(delivered.x).toBeLessThan(deliveryBounds.right);
    expect(delivered.y + delivered.height).toBeGreaterThan(deliveryBounds.top);
    expect(delivered.y).toBeLessThan(deliveryBounds.bottom);
  }
  expect(new Set(deliveredNodes.map((node) => `${node.x}:${node.y}`)).size).toBe(2);
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
  const compactSession = page.getByTestId("relay-session-indicator");
  await expect(compactSession).toBeVisible();
  await expect(compactSession).toContainText(session.targetViewTitle);
  await expect(compactSession).toContainText(`Installed 1 artifact into ${session.targetViewTitle}`);
  await expect(compactSession.locator('[role="status"]')).toHaveAttribute("aria-live", "polite");
  await expect(compactSession.getByRole("button", { name: "End" })).toBeVisible();
  await page.getByTestId("relay-session-reopen").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
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
  const afterReload = agentArtifactBundle("relay-after-reload");
  try {
    const racedCleanup = await runDelivery(testInfo, session, [afterReload]);
    expect(racedCleanup.accepted).toBe(true);
  } catch (error) {
    expect(String(error)).toContain("session_expired");
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), afterReload.artifactId)).toBe(false);
});

test("a stale tab cannot overwrite a relay commit and Undo removes only the delivery", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  const sibling = await page.context().newPage();
  await sibling.goto("/");
  await sibling.getByTestId("canvas-stage").waitFor({ state: "visible" });

  await sibling.getByTestId("canvas-title").dblclick();
  await sibling.getByTestId("canvas-title-input").fill("Shared planning view");
  await sibling.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => readWorkspaceTitle(sibling, session.targetViewId)).toBe("Shared planning view");

  const bundle = agentArtifactBundle("relay-revision-guard");
  await runDelivery(testInfo, session, [bundle]);
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.artifactIds.includes(artifactId), bundle.artifactId)).toBe(true);
  await expect(page.getByTestId("canvas-title")).toHaveText("Shared planning view");
  await page.getByTitle("Close", { exact: true }).click();

  await page.keyboard.press("Meta+z");
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId), bundle.artifactId)).toBe(false);
  await expect(page.getByTestId("canvas-title")).toHaveText("Shared planning view");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId), bundle.artifactId)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await sibling.getByTestId("canvas-title").dblclick();
  await sibling.getByTestId("canvas-title-input").fill("Stale overwrite attempt");
  await sibling.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => sibling.evaluate(() => window.__FREEFORM_STATE__!.status))
    .toContain("changed in another browser tab");

  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect(page.getByTestId("canvas-title")).toHaveText("Shared planning view");
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.artifactIds.includes(artifactId), bundle.artifactId)).toBe(true);
  await sibling.close();
});

test("a stale tab cannot resurrect a deleted target view", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId))
    .not.toBe("market-overview");
  const safeViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  expect(safeViewId).not.toBe("market-overview");
  await page.getByTestId("view-market-overview").click();

  const stale = await page.context().newPage();
  await stale.goto("/?view=market-overview");
  await stale.getByTestId("canvas-stage").waitFor({ state: "visible" });

  await page.getByTestId("view-menu-market-overview").click();
  await page.getByTestId("delete-view-market-overview").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).not.toBe("market-overview");
  await expect.poll(async () => stale.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).not.toBe("market-overview");

  await stale.close();
  await page.goto("/?view=market-overview");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  expect(await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).not.toBe("market-overview");
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.locator('[data-view-id="market-overview"]')).toHaveCount(0);
});

test("relay delivery remains undoable without clearing earlier local history", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  const initialCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  await page.keyboard.press("Meta+d");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 1);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  const bundle = agentArtifactBundle("relay-history-card");
  await runDelivery(testInfo, session, [bundle]);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 2);

  await page.keyboard.press("Meta+z");
  await expect.poll(async () => page.evaluate((artifactId) => ({
    count: window.__FREEFORM_STATE__!.nodes.length,
    delivered: window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId),
  }), bundle.artifactId)).toEqual({ count: initialCount + 1, delivered: false });
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount);

  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => page.evaluate((artifactId) => ({
    count: window.__FREEFORM_STATE__!.nodes.length,
    delivered: window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId),
  }), bundle.artifactId)).toEqual({ count: initialCount + 2, delivered: true });
});

test("an immediate delivery preserves edits still inside the autosave window", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Unsaved relay draft");
  await page.getByTestId("canvas-title-input").press("Enter");

  const bundle = agentArtifactBundle("relay-autosave-window-card");
  await runDelivery(testInfo, session, [bundle]);
  await expect(page.getByTestId("canvas-title")).toHaveText("Unsaved relay draft");
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId), bundle.artifactId)).toBe(true);

  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect(page.getByTestId("canvas-title")).toHaveText("Unsaved relay draft");
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId), bundle.artifactId)).toBe(true);
});

test("relay installation locks workspace interaction until its atomic transaction commits", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  const originalTitle = await page.getByTestId("canvas-title").innerText();
  await page.getByTestId("canvas-title").dblclick();
  const titleInput = page.getByTestId("canvas-title-input");
  await expect(titleInput).toBeFocused();
  await expect(titleInput).toHaveValue(originalTitle);

  await page.evaluate(() => {
    const relayProbe = window as unknown as {
      __relayTxStarted?: boolean;
      __relayTxReleased?: boolean;
      __relayTxCompleted?: boolean;
    };
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      storeNames: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      const transaction = originalTransaction.call(this, storeNames, mode, options);
      const names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
      if (mode === "readwrite" && names.includes("relay-receipts")) {
        relayProbe.__relayTxStarted = true;
        transaction.addEventListener("complete", () => {
          relayProbe.__relayTxCompleted = true;
        }, { once: true });
        const receiptStore = transaction.objectStore("relay-receipts");
        const startedAt = performance.now();
        const keepAlive = () => {
          if (performance.now() - startedAt >= 2_500) {
            relayProbe.__relayTxReleased = true;
            return;
          }
          const request = receiptStore.get("__relay-install-lock-keepalive__");
          request.addEventListener("success", keepAlive, { once: true });
        };
        keepAlive();
      }
      return transaction;
    } as typeof originalTransaction;
  });

  const bundle = agentArtifactBundle("relay-install-lock-card");
  const upload = runDelivery(testInfo, session, [bundle]);
  await expect.poll(async () => page.evaluate(() => Boolean(
    (window as unknown as { __relayTxStarted?: boolean }).__relayTxStarted,
  ))).toBe(true);

  const appShell = page.locator("main.canvas-app-shell");
  const workspace = page.locator("section.workspace");
  await expect(appShell).toHaveAttribute("aria-busy", "true");
  await expect(workspace).toHaveAttribute("inert", "");
  await expect(page.getByTestId("relay-install-progress")).toContainText("Installing delivery");
  await expect(titleInput).toHaveCount(0);
  const lockedTitle = page.getByTestId("canvas-title");
  await expect(lockedTitle).toHaveText(originalTitle);
  const titleBox = await lockedTitle.boundingBox();
  expect(titleBox).not.toBeNull();
  await page.mouse.dblclick(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.keyboard.type(" blocked title mutation");
  await expect(page.getByTestId("canvas-title-input")).toHaveCount(0);
  await expect(lockedTitle).toHaveText(originalTitle);

  await upload;
  await expect.poll(async () => page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.artifactIds.includes(artifactId), bundle.artifactId), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => page.evaluate(() => Boolean(
    (window as unknown as { __relayTxCompleted?: boolean }).__relayTxCompleted,
  ))).toBe(true);
  await expect(appShell).not.toHaveAttribute("aria-busy", "true");
  await expect(workspace).not.toHaveAttribute("inert", "");
  await expect(lockedTitle).toHaveText(originalTitle);

  const persisted = await page.evaluate(async ({ artifactId, targetViewId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ title: string; board: { nodes: Array<{ artifactId: string }> } }>((resolve, reject) => {
      const request = database.transaction("workspaces", "readonly").objectStore("workspaces").get(targetViewId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      title: record.title,
      artifactInstalled: record.board.nodes.some((node) => node.artifactId === artifactId),
    };
  }, { artifactId: bundle.artifactId, targetViewId: session.targetViewId });
  expect(persisted).toEqual({ title: originalTitle, artifactInstalled: true });
});

test("host placement keeps full-view fallbacks visible, staggered, and on top", async ({ page }, testInfo) => {
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
  const initialNodes = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes);
  const placement = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    const rect = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const centerX = (rect.width / 2 - state.viewport.x) / state.viewport.scale;
    const centerY = (rect.height / 2 - state.viewport.y) / state.viewport.scale;
    return {
      origin: {
        x: Math.round(Math.round(centerX - 1_000) / 38) * 38,
        y: Math.round(Math.round(centerY - 700) / 38) * 38,
      },
      bounds: {
        left: -state.viewport.x / state.viewport.scale,
        right: (rect.width - state.viewport.x) / state.viewport.scale,
        top: -state.viewport.y / state.viewport.scale,
        bottom: (rect.height - state.viewport.y) / state.viewport.scale,
      },
    };
  });
  await runDelivery(testInfo, session, [first, second]);
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 2 artifacts");
  const nodes = await page.evaluate((ids) =>
    window.__FREEFORM_STATE__!.nodes.filter((node) => ids.includes(node.artifactId)),
  [first.artifactId, second.artifactId]);
  expect(nodes).toHaveLength(2);
  expect(nodes.every((node) => node.x % 38 === 0 && node.y % 38 === 0)).toBe(true);
  expect(nodes[0]).toMatchObject(placement.origin);
  expect(nodes[1]).toMatchObject({
    x: placement.origin.x + 38,
    y: placement.origin.y + 38,
  });
  expect(nodesOverlapWithGap(nodes[0], nodes[1])).toBe(true);
  for (const delivered of nodes) {
    expect(delivered.x + delivered.width).toBeGreaterThan(placement.bounds.left);
    expect(delivered.x).toBeLessThan(placement.bounds.right);
    expect(delivered.y + delivered.height).toBeGreaterThan(placement.bounds.top);
    expect(delivered.y).toBeLessThan(placement.bounds.bottom);
  }
  const previousHighestZ = Math.max(...initialNodes.map((node) => node.zIndex));
  expect(nodes[0].zIndex).toBe(previousHighestZ + 1);
  expect(nodes[1].zIndex).toBeGreaterThan(nodes[0].zIndex);
});

test("host placement centers a readable multi-artifact grid when the selection fits", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  const stage = page.getByTestId("canvas-stage");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await stage.dispatchEvent("wheel", { deltaX: 1_800, deltaY: 1_200 });
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    const rect = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const bounds = {
      left: -state.viewport.x / state.viewport.scale,
      right: (rect.width - state.viewport.x) / state.viewport.scale,
      top: -state.viewport.y / state.viewport.scale,
      bottom: (rect.height - state.viewport.y) / state.viewport.scale,
    };
    return state.nodes.filter((node) =>
      node.x < bounds.right && node.x + node.width > bounds.left &&
      node.y < bounds.bottom && node.y + node.height > bounds.top).length;
  })).toBe(0);

  const first = agentArtifactBundle("relay-grid-one");
  const second = agentArtifactBundle("relay-grid-two");
  await runDelivery(testInfo, session, [first, second]);
  await expect(page.getByTestId("relay-session-indicator")).toContainText("Installed 2 artifacts");
  const placement = await page.evaluate((artifactIds) => {
    const state = window.__FREEFORM_STATE__!;
    const rect = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const nodes = state.nodes.filter((node) => artifactIds.includes(node.artifactId));
    const bounds = {
      left: -state.viewport.x / state.viewport.scale,
      right: (rect.width - state.viewport.x) / state.viewport.scale,
      top: -state.viewport.y / state.viewport.scale,
      bottom: (rect.height - state.viewport.y) / state.viewport.scale,
    };
    return { bounds, nodes };
  }, [first.artifactId, second.artifactId]);
  expect(placement.nodes).toHaveLength(2);
  expect(nodesOverlapWithGap(placement.nodes[0], placement.nodes[1])).toBe(false);
  expect(placement.nodes.every((node) =>
    node.x >= placement.bounds.left && node.x + node.width <= placement.bounds.right &&
    node.y >= placement.bounds.top && node.y + node.height <= placement.bounds.bottom)).toBe(true);
  expect(placement.nodes.every((node) => node.x % 38 === 0 && node.y % 38 === 0)).toBe(true);
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
  await expect(page.getByTestId("relay-transport-state")).toContainText("Live delivery ready");
  await expect(page.getByTestId("relay-transport-state")).not.toContainText("Delivery rejected");
  const outcome = page.getByTestId("relay-delivery-outcome");
  await expect(outcome).toContainText("Delivery rejected. Nothing was installed.");
  await expect(outcome).toContainText("different number of values and categories");
  await expect(outcome).toContainText("Last delivery");
  await expect(outcome.getByText("Delivery rejected. Nothing was installed.", { exact: true })).toHaveCSS("white-space", "normal");
  expect(await readArtifactPackage(page, valid.artifactId)).toBeUndefined();
  expect(await readArtifactPackage(page, invalid.artifactId)).toBeUndefined();
  expect(await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount);
  await page.getByTitle("Close", { exact: true }).click();
  const compactOutcome = page.getByTestId("relay-session-indicator");
  await expect(compactOutcome).toContainText("Delivery rejected. Nothing was installed.");
  await compactOutcome.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByTestId("relay-delivery-outcome")).toContainText("different number of values and categories");
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
  await page.getByTestId("relay-session-reopen").click();
  await expect(page.getByTestId("agent-instruction")).toContainText(`Target Freeform view id: ${session.targetViewId}`);
  await expect(page.getByTestId("agent-instruction")).not.toContainText(`Target Freeform view id: ${otherViewId}`);
  const offlineBundle = agentArtifactBundle("offline-bound-view-card");
  await page.getByTestId("artifact-bundle-file").setInputFiles({
    name: "offline-bound-view-card.freeform-artifact.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(offlineBundle)),
  });
  await expect(page.getByRole("heading", { name: "Build with AI" })).toBeVisible();
  await expect(page.locator(".agent-dialog-feedback")).toContainText("Installed offline-bound-view-card.freeform-artifact.json into Market overview");
  await expect(page.getByTestId("open-installed-view")).toContainText("Open Market overview");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);
  await page.getByTitle("Close", { exact: true }).click();
  await expect(page.getByTestId("relay-session-reopen")).toBeFocused();

  const bundle = agentArtifactBundle("relay-bound-view-card");
  await runDelivery(testInfo, session, [bundle]);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-tab-personal").click();
  await expect(page.getByTestId(`artifact-library-item-${bundle.artifactId}`)).toBeVisible();
  await page.getByTitle("Close artifacts").click();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId(`view-${session.targetViewId}`).click();
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), bundle.artifactId)).toBe(true);
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), offlineBundle.artifactId)).toBe(true);
  await expect(page.getByText("Installed without a deploy")).toHaveCount(2);
});

test("deleting the target during delivery rejects it without resurrecting the view", async ({ page, context }, testInfo) => {
  let resolveRejectedAck!: () => void;
  const rejectedAck = new Promise<void>((resolve) => { resolveRejectedAck = resolve; });
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === "string" && message.includes('"type":"ack"') && message.includes('"outcome":"rejected"')) {
        resolveRejectedAck();
      }
      server.send(message);
    });
  });
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId))
    .not.toBe("market-overview");
  const safeViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  await page.getByTestId("view-market-overview").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId))
    .toBe("market-overview");

  const deleter = await context.newPage();
  await deleter.goto("/?view=market-overview");
  await deleter.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await deleter.getByTestId("sidebar-toggle").click();

  const session = await openBuildSession(page);
  const slow = agentArtifactBundle("relay-deleted-target-card");
  slow.moduleSource = `window.__relayDeletedTargetInstallStarted = true;
await new Promise((resolve) => setTimeout(resolve, 1200));
${slow.moduleSource}`;
  const upload = runDelivery(testInfo, session, [slow]);
  await expect.poll(async () => page.evaluate(() => Boolean(
    (window as unknown as { __relayDeletedTargetInstallStarted?: boolean }).__relayDeletedTargetInstallStarted,
  ))).toBe(true);

  await deleter.getByTestId("view-menu-market-overview").click();
  await deleter.getByTestId("delete-view-market-overview").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).toBe(safeViewId);
  await upload;
  await rejectedAck;

  expect(await readArtifactPackage(page, slow.artifactId)).toBeUndefined();
  await expect(page.locator('[data-view-id="market-overview"]')).toHaveCount(0);
  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.locator('[data-view-id="market-overview"]')).toHaveCount(0);
  expect(await readArtifactPackage(page, slow.artifactId)).toBeUndefined();
});

test("restoring a deleted target creates a new incarnation that rejects its old session", async ({ page, context }, testInfo) => {
  let resolveRejectedAck!: () => void;
  const rejectedAck = new Promise<void>((resolve) => { resolveRejectedAck = resolve; });
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === "string" && message.includes('"type":"ack"') && message.includes('"outcome":"rejected"')) {
        resolveRejectedAck();
      }
      server.send(message);
    });
  });

  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId))
    .not.toBe("market-overview");
  const safeViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  await page.getByTestId("view-market-overview").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId))
    .toBe("market-overview");

  const session = await openBuildSession(page);
  expect(await readWorkspaceIncarnation(page, session.targetViewId)).toBe(session.targetViewIncarnationId);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("view-menu-market-overview").click();
  await page.getByTestId("delete-view-market-overview").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId)).toBe(safeViewId);
  await page.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("view-market-overview")).toBeVisible();
  const restoredIncarnation = await readWorkspaceIncarnation(page, session.targetViewId);
  expect(restoredIncarnation).not.toBeNull();
  expect(restoredIncarnation).not.toBe(session.targetViewIncarnationId);

  const bundle = agentArtifactBundle("relay-old-incarnation-card");
  await runDelivery(testInfo, session, [bundle]);
  await rejectedAck;
  expect(await readArtifactPackage(page, bundle.artifactId)).toBeUndefined();
  await page.getByTestId(`view-${session.targetViewId}`).click();
  expect(await page.evaluate((artifactId) =>
    window.__FREEFORM_STATE__!.nodes.some((node) => node.artifactId === artifactId), bundle.artifactId)).toBe(false);
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
  await expect(page.getByTestId("relay-session-status")).toContainText("Restoring live delivery");
  const bundle = agentArtifactBundle("relay-reconnect-card");
  const accepted = await runDelivery(testInfo, session, [bundle]);
  expect(accepted.duplicate).toBe(false);
  blockConnections = false;
  await expect(page.getByTestId("relay-session-status")).toContainText("Installed 1 artifact", { timeout: 15_000 });
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), bundle.artifactId)).toBe(true);
  blockConnections = true;
  (browserSocket as WebSocketRoute | null)?.close({ code: 1012, reason: "Second Playwright interruption" });
  await expect(page.getByTestId("relay-transport-state")).toContainText("Restoring live delivery");
  await expect(page.getByTestId("relay-transport-state")).not.toContainText("Installed 1 artifact");
  await expect(page.getByTestId("relay-delivery-outcome")).toContainText("Installed 1 artifact");
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
  (browserSocket as WebSocketRoute | null)?.send(JSON.stringify({ version: 2, type: "expired" }));
  await expect(page.getByTestId("relay-session-status")).toContainText("Live session expired");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await expect(page.getByTestId("copy-agent-instruction")).toContainText("Copy build brief");
  await expect(page.getByTestId("copy-agent-instruction")).not.toContainText("Copied");
  await expect(page.getByTestId("agent-instruction")).toContainText("Delivery mode: BROWSER_VIEW_BUNDLE");
  await expect(page.getByTestId("agent-instruction")).not.toContainText(session.uploadToken);
});

test("a terminal relay protocol error can be reopened and explicitly retried", async ({ page, context }) => {
  const browserSockets: WebSocketRoute[] = [];
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect$/, (socket) => {
    browserSockets.push(socket);
    socket.connectToServer();
  });
  await openBuildSession(page);
  expect(browserSockets).toHaveLength(1);

  browserSockets[0]?.send(JSON.stringify({
    version: 2,
    type: "error",
    code: "invalid_message",
  }));
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery unavailable");
  await expect(page.getByTestId("relay-transport-state")).toContainText(
    "Relay rejected the browser protocol: invalid_message",
  );

  await page.getByTitle("Close", { exact: true }).click();
  await page.getByTestId("build-artifact").click();
  await expect.poll(() => browserSockets.length).toBe(2);
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");

  browserSockets[1]?.send(JSON.stringify({
    version: 1,
    type: "ready",
  }));
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery unavailable");
  await expect(page.getByTestId("relay-transport-state")).toContainText(
    "Relay sent an invalid protocol message",
  );
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect.poll(() => browserSockets.length).toBe(3);
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
});

test("an old session-creation protocol response fails closed before retry", async ({ page }) => {
  await stubTurnstile(page);
  let creationAttempt = 0;
  await page.route(/\/v1\/sessions$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    creationAttempt += 1;
    if (creationAttempt > 1) {
      await route.continue();
      return;
    }
    const request = route.request().postDataJSON() as {
      targetViewId: string;
      targetViewIncarnationId: string;
    };
    const requestOrigin = route.request().headers().origin ?? new URL(page.url()).origin;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" },
      body: JSON.stringify({
        version: 1,
        sessionId: crypto.randomUUID(),
        targetViewId: request.targetViewId,
        targetViewIncarnationId: request.targetViewIncarnationId,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    });
  });
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery unavailable");
  await expect(page.getByTestId("relay-transport-state")).toContainText(
    "Relay returned an invalid Build Session response",
  );
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await expect(page.getByTestId("agent-instruction")).toContainText("Delivery mode: BROWSER_VIEW_BUNDLE");

  await page.getByRole("button", { name: "Retry live delivery" }).click();
  await expect.poll(() => creationAttempt).toBe(2);
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
});

test("a browser without Web Locks fails closed before creating a Build Session", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });
  let creationAttempts = 0;
  await page.route(/\/v1\/sessions$/, async (route) => {
    if (route.request().method() === "POST") creationAttempts += 1;
    await route.abort();
  });
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("build-artifact").click();

  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery unavailable");
  await expect(page.getByTestId("relay-transport-state")).toContainText(
    "Build Sessions need this browser's cross-tab locking support",
  );
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await expect(page.getByTestId("agent-instruction")).toContainText("Delivery mode: BROWSER_VIEW_BUNDLE");
  await expect(page.getByTestId("agent-instruction")).not.toContainText("--credentials-stdin");
  expect(creationAttempts).toBe(0);

  await page.getByRole("button", { name: "Retry live delivery" }).click();
  await expect(page.getByTestId("relay-transport-state")).toContainText(
    "Build Sessions need this browser's cross-tab locking support",
  );
  expect(creationAttempts).toBe(0);
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
    const requestOrigin = route.request().headers().origin ?? new URL(page.url()).origin;
    const corsHeaders = { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" };
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
      const request = route.request().postDataJSON() as {
        targetViewId: string;
        targetViewIncarnationId: string;
      };
      await staleCreationGate;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({
          version: 2,
          sessionId: crypto.randomUUID(),
          targetViewId: request.targetViewId,
          targetViewIncarnationId: request.targetViewIncarnationId,
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
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery unavailable");
  await expect(page.getByTestId("relay-session-status")).toContainText("Build Sessions are temporarily unavailable. Try again shortly.");
  await expect(page.getByTestId("relay-session-status")).not.toContainText("temporarily_unavailable");
  await page.getByRole("button", { name: "Retry live delivery" }).click();
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
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  await expect(page.getByTestId("agent-instruction")).toContainText(`Target Freeform view id: ${latestViewId}`);
});

test("ending a session cancels in-flight work and a reload exposes no capability", async ({ page }, testInfo) => {
  const session = await openBuildSession(page);
  await page.getByTitle("Close", { exact: true }).click();
  const slow = agentArtifactBundle("relay-cancelled-in-flight");
  slow.moduleSource = `window.__relaySlowInstallStarted = true;
await new Promise((resolve) => setTimeout(resolve, 1200));
${slow.moduleSource}`;
  await runDelivery(testInfo, session, [slow]);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __relaySlowInstallStarted?: boolean }).__relaySlowInstallStarted))).toBe(true);
  await expect(page.locator("main.canvas-app-shell")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("section.workspace")).not.toHaveAttribute("inert", "");
  await page.getByTestId("relay-session-indicator").getByRole("button", { name: "End", exact: true }).click();
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
        response.end(JSON.stringify({
          version: 2,
          accepted: true,
          duplicate: true,
          deliveryId: delivery.deliveryId,
        }));
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
    "--view-incarnation-id", crypto.randomUUID(),
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
