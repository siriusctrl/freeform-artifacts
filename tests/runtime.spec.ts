import { expect, test } from "@playwright/test";
import { agentArtifactBundle } from "./helpers/runtimeBundle";

test("agent bundles install into a view without a repository change and survive reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect.poll(async () => page.evaluate(() => Boolean(window.__FREEFORM_AGENT__))).toBe(true);
  const bundle = agentArtifactBundle();
  const result = await page.evaluate(async (value) => window.__FREEFORM_AGENT__!.installArtifact(value), bundle);
  expect(result.artifactId).toBe(bundle.artifactId);
  await expect(page.getByTestId(`node-${result.nodeId}`)).toBeVisible();
  await expect(page.getByText("Installed without a deploy")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.reload();
  await expect(page.getByTestId(`node-${result.nodeId}`)).toBeVisible();
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), bundle.artifactId)).toBe(true);

  await page.getByTestId("build-artifact").click();
  const fileBundle = agentArtifactBundle("agent-file-card");
  await page.getByTestId("artifact-bundle-file").setInputFiles({
    name: "agent-file-card.freeform-artifact.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fileBundle)),
  });
  await expect.poll(async () => page.evaluate((id) => window.__FREEFORM_STATE__!.artifactIds.includes(id), fileBundle.artifactId)).toBe(true);
  await expect(page.getByText("Installed without a deploy")).toHaveCount(2);
});

test("runtime artifacts isolate failures, reject code collisions, and commit only valid targets", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });

  const brokenBundle = {
    ...agentArtifactBundle("broken-runtime-card"),
    moduleSource: `export const artifact = {
      id: "broken-runtime-card",
      renderer: "echarts",
      title: "Broken runtime card",
      version: "1.0.0",
      defaultSize: { width: 420, height: 260 },
      buildOption: () => { throw new Error("Intentional artifact failure"); },
    };`,
  };
  const brokenResult = await page.evaluate(
    async (value) => window.__FREEFORM_AGENT__!.installArtifact(value),
    brokenBundle,
  );
  await expect(page.getByTestId(`node-${brokenResult.nodeId}`)).toContainText("Unable to render this artifact");
  await expect(page.getByTestId("node-node-revenue")).toBeVisible();

  const original = agentArtifactBundle("immutable-runtime-card");
  await page.evaluate(async (value) => window.__FREEFORM_AGENT__!.installArtifact(value), original);
  const collision = {
    ...original,
    moduleSource: original.moduleSource.replace("Agent Forecast", "Replaced Forecast"),
  };
  const collisionMessage = await page.evaluate(async (value) => {
    try {
      await window.__FREEFORM_AGENT__!.installArtifact(value);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, collision);
  expect(collisionMessage).toContain("already installed with different code");

  const rejected = agentArtifactBundle("unknown-view-card");
  const targetMessage = await page.evaluate(async (value) => {
    try {
      await window.__FREEFORM_AGENT__!.installArtifact(value, { viewId: "missing-view" });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, rejected);
  expect(targetMessage).toContain("Unknown canvas view");
  const leakedPackage = await page.evaluate(async (artifactId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const request = database.transaction("artifact-packages", "readonly").objectStore("artifact-packages").get(artifactId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  }, rejected.artifactId);
  expect(leakedPackage).toBeUndefined();
});

test("one corrupt installed package does not suppress healthy runtime artifacts", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  const healthy = agentArtifactBundle("healthy-runtime-card");
  await page.evaluate(async (value) => window.__FREEFORM_AGENT__!.installArtifact(value), healthy);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("artifact-packages", "readwrite");
      transaction.objectStore("artifact-packages").put({ artifactId: "corrupt-package", moduleSource: "not valid" });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactIds)).toContain(healthy.artifactId);
  await expect(page.getByText("Installed without a deploy")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toContain("artifact issue");
});

test("board-data import reports missing personal packages before changing the view", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  const nodeCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  const workspace = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    return {
      version: 1,
      templateId: "market-overview",
      title: "Missing package backup",
      templateVersion: 3,
      updatedAt: new Date().toISOString(),
      board: {
        version: 1,
        nodes: [...state.nodes, {
          id: "node-missing-package",
          artifactId: "missing-personal-package",
          title: "Missing package",
          x: 0,
          y: 0,
          width: 420,
          height: 260,
          zIndex: 99,
          data: {},
          config: {},
        }],
        viewport: state.viewport,
        selectedNodeId: "",
        themeMode: state.themeMode,
        snapToGrid: state.snapToGrid,
      },
    };
  });

  await page.getByTestId("workspace-file").setInputFiles({
    name: "missing-package.freeform.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toContain(
    "Install missing artifact package before importing: missing-personal-package",
  );
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(nodeCount);
});
