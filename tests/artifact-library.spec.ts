import { expect, test } from "@playwright/test";
import { agentArtifactBundle } from "./helpers/runtimeBundle";

test("canvas shortcuts and the built-in library restore or place artifacts", async ({ page }) => {
  await page.goto("/");
  const stage = page.getByTestId("canvas-stage");
  await stage.waitFor({ state: "visible" });

  await page.keyboard.press("Meta+b");
  await expect(page.getByTestId("canvas-sidebar")).toBeVisible();
  await page.keyboard.press("Meta+b");
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();

  const initialScale = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale);
  await page.keyboard.press("+");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBeGreaterThan(initialScale);
  await page.keyboard.press("Meta+0");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport)).toEqual({ x: 80, y: 80, scale: 1 });

  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").press("Meta+b");
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();
  await page.getByTestId("canvas-title-input").press("Escape");

  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  await page.keyboard.press("Meta+Shift+a");
  await expect(page.getByTestId("artifact-library")).toBeVisible();
  await expect(page.getByTitle("Close artifacts")).toBeFocused();
  const nodeCountWhileLibraryFocused = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(nodeCountWhileLibraryFocused);
  await expect(page.getByTestId("artifact-tab-built-in")).toContainText("5");
  await page.getByTestId("artifact-tab-built-in").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("artifact-tab-personal")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("artifact-tab-built-in")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("artifact-search").fill("metric");
  await expect(page.getByTestId("artifact-library-item-metric-card")).toBeVisible();
  await expect(page.getByTestId("artifact-library-item-sankey-flow")).toHaveCount(0);
  await page.getByTestId("artifact-search").fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("artifact-library")).not.toBeVisible();
  await expect(page.getByTestId("artifact-library-toggle")).toBeFocused();

  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-library-item-metric-card").click();
  await expect.poll(async () => {
    const nodes = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes);
    return nodes.find((node) => node.artifactId === "metric-card")?.id ?? "";
  }).not.toBe("");
  const restoredMetricId = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.find((node) => node.artifactId === "metric-card")!.id);
  await expect(page.getByTestId("artifact-library")).not.toBeVisible();
  await expect(stage).toBeFocused();
  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!.nodes)).find((entry) => entry.artifactId === "metric-card");
    return node ? [node.x % 38, node.y % 38] : null;
  }).toEqual([0, 0]);
  const restoredMetric = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.find((node) => node.artifactId === "metric-card")!);
  expect(Math.abs(restoredMetric.x - 80)).toBeLessThanOrEqual(38);
  expect(Math.abs(restoredMetric.y - 90)).toBeLessThanOrEqual(38);
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("import-data").click();
  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!.nodes)).find((entry) => entry.artifactId === "metric-card");
    return (node?.data as { value?: number } | undefined)?.value;
  }).toBe(232_400);

  const flowCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.filter((node) => node.artifactId === "flow-diagram").length);
  await stage.dispatchEvent("wheel", { deltaX: 114, deltaY: 76 });
  await page.keyboard.press("+");
  const dropViewport = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport);
  const targetPosition = { x: 640, y: 500 };
  const expectedPosition = {
    x: Math.round((((targetPosition.x - dropViewport.x) / dropViewport.scale) - 560 / 2) / 38) * 38,
    y: Math.round((((targetPosition.y - dropViewport.y) / dropViewport.scale) - 300 / 2) / 38) * 38,
  };
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-library-item-flow-diagram").dragTo(stage, {
    targetPosition,
  });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.filter((node) => node.artifactId === "flow-diagram").length)).toBe(flowCount + 1);
  const droppedFlow = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    return state.nodes.find((node) => node.id === state.selectedNodeId);
  });
  expect(droppedFlow).toMatchObject(expectedPosition);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.reload();
  await expect(page.getByTestId(`node-${restoredMetricId}`)).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.filter((node) => node.artifactId === "flow-diagram").length)).toBe(flowCount + 1);
});

test("runtime initialization preserves a package installed while the external manifest is pending", async ({ page }) => {
  let releaseManifest!: () => void;
  let manifestRequested!: () => void;
  const manifestGate = new Promise<void>((resolve) => { releaseManifest = resolve; });
  const manifestSeen = new Promise<void>((resolve) => { manifestRequested = resolve; });
  await page.route("**/artifacts/generated/manifest.json", async (route) => {
    manifestRequested();
    await manifestGate;
    await route.continue();
  });

  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await manifestSeen;
  const bundle = agentArtifactBundle("install-during-runtime-load");
  const installed = await page.evaluate(async (value) => window.__FREEFORM_AGENT__!.installArtifact(value), bundle);
  await expect(page.getByTestId(`node-${installed.nodeId}`)).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactLibraryCounts.personal)).toBe(1);

  releaseManifest();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactIds)).toContain("runtime-margin-chart");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactLibraryCounts.personal)).toBe(1);
  await expect(page.getByTestId(`node-${installed.nodeId}`)).toBeVisible();
  await expect(page.getByText("Installed without a deploy")).toBeVisible();
});

test("personal artifacts stay in the shared library across views but not browser profiles", async ({ browser }) => {
  const owner = await browser.newContext();
  const visitor = await browser.newContext();

  try {
    const page = await owner.newPage();
    await page.goto("/");
    await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
    const bundle = agentArtifactBundle("personal-library-card");
    const installed = await page.evaluate(async (value) => window.__FREEFORM_AGENT__!.installArtifact(value), bundle);
    await expect(page.getByTestId(`node-${installed.nodeId}`)).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactLibraryCounts.personal)).toBe(1);

    await page.getByTestId(`node-${installed.nodeId}`).click({ position: { x: 100, y: 16 } });
    await page.keyboard.press("Delete");
    await expect(page.getByTestId(`node-${installed.nodeId}`)).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+a");
    await page.getByTestId("artifact-tab-personal").click();
    await expect(page.getByTestId(`artifact-library-item-${bundle.artifactId}`)).toBeVisible();

    await page.keyboard.press("Meta+b");
    await expect(page.getByTestId("artifact-library")).not.toBeVisible();
    await page.getByTestId("create-view").click();
    await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);
    await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactLibraryCounts.personal)).toBe(1);

    await page.keyboard.press("Meta+Shift+a");
    await page.getByTestId("artifact-tab-personal").click();
    await page.getByTestId(`artifact-library-item-${bundle.artifactId}`).click();
    await expect.poll(async () => {
      const nodes = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes);
      return nodes.find((node) => node.artifactId === bundle.artifactId)?.id ?? "";
    }).not.toBe("");
    const personalNodeId = await page.evaluate((artifactId) => window.__FREEFORM_STATE__!.nodes.find((node) => node.artifactId === artifactId)!.id, bundle.artifactId);
    await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await page.reload();
    await expect(page.getByTestId(`node-${personalNodeId}`)).toBeVisible();

    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/");
    await visitorPage.getByTestId("canvas-stage").waitFor({ state: "visible" });
    await expect.poll(async () => visitorPage.evaluate(() => window.__FREEFORM_STATE__!.artifactLibraryCounts.personal)).toBe(0);
    await visitorPage.getByTestId("artifact-library-toggle").click();
    await visitorPage.getByTestId("artifact-tab-personal").click();
    await expect(visitorPage.getByTestId("artifact-library-empty")).toBeVisible();
  } finally {
    await owner.close();
    await visitor.close();
  }
});
