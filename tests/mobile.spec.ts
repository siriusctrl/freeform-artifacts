import { expect, test } from "@playwright/test";
import { stubTurnstile } from "./helpers/relay";

test("mobile canvas keeps core controls visible without horizontal overflow", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto("/");
  await expect(page.getByTestId("canvas-stage")).toBeVisible();
  await expect(page.getByTestId("artifact-library-toggle")).toBeVisible();
  await expect(page.getByTestId("build-artifact")).not.toBeVisible();
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  const topbarMetrics = await page.evaluate(() => ({
    height: Math.round(document.querySelector(".topbar")!.getBoundingClientRect().height),
    fontFamily: getComputedStyle(document.querySelector(".canvas-title-slot")!).fontFamily,
  }));
  expect(topbarMetrics.height).toBe(54);
  expect(topbarMetrics.fontFamily).toContain("Instrument Sans Variable");

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBe(0.48);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  await page.getByTestId("artifact-library-toggle").click();
  await expect(page.getByTestId("artifact-library")).toBeVisible();
  await expect.poll(async () => page.getByTestId("artifact-library").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(0, rect.right - window.innerWidth);
  })).toBeLessThanOrEqual(1);
  const libraryMetrics = await page.getByTestId("artifact-library").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
  });
  expect(libraryMetrics.left).toBeGreaterThanOrEqual(-1);
  expect(libraryMetrics.right).toBeLessThanOrEqual(libraryMetrics.viewport + 1);
  expect(libraryMetrics.width).toBe(libraryMetrics.viewport);
  await expect(page.getByTestId("artifact-tab-built-in")).toContainText("5");
  const metricPreview = page.getByTestId("artifact-preview-metric-card");
  await expect(metricPreview).toHaveAttribute("data-preview-ready", "true");
  const previewContained = await metricPreview.evaluate((frame) => {
    const node = frame.querySelector<HTMLElement>(".artifact-preview-node")!;
    const frameRect = frame.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return nodeRect.left >= frameRect.left && nodeRect.right <= frameRect.right &&
      nodeRect.top >= frameRect.top && nodeRect.bottom <= frameRect.bottom;
  });
  expect(previewContained).toBe(true);
  await page.getByTestId("artifact-library-item-metric-card").click();
  const addedMetricVisibility = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    const selected = document.querySelector<HTMLElement>(`[data-testid="node-${state.selectedNodeId}"]`)!.getBoundingClientRect();
    const stage = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    return {
      left: selected.left >= stage.left - 1,
      right: selected.right <= stage.right + 1,
      top: selected.top >= stage.top - 1,
      bottom: selected.bottom <= stage.bottom + 1,
    };
  });
  expect(addedMetricVisibility).toEqual({ left: true, right: true, top: true, bottom: true });
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-tab-personal").click();
  await expect(page.getByTestId("artifact-library-empty")).toBeVisible();
  const nodeCount = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length;
  await page.getByTestId("library-build-artifact").click();
  await expect(page.getByTestId("agent-request")).toHaveCount(0);
  await expect(page.getByTestId("relay-session-status")).toContainText("Relay connected");
  await expect(page.getByTestId("agent-instruction")).toContainText("Ask the user what they want to build");
  await expect(page.getByTestId("agent-instruction")).toContainText("Delivery mode: BROWSER_RELAY");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  const dialogDimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dialogDimensions.scrollWidth).toBeLessThanOrEqual(dialogDimensions.innerWidth);
  expect((await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length).toBe(nodeCount);
  await page.getByTitle("Close", { exact: true }).click();

  await page.getByTestId("workspace-menu").click();
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitem", { name: "Load sample data" })).toBeVisible();
});

test("short landscape keeps every Build Session action reachable", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await stubTurnstile(page);
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-tab-personal").click();
  await page.getByTestId("library-build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Relay connected");
  await expect(page.getByTestId("relay-session-status").locator("time")).toBeVisible();
  const metrics = await page.locator(".agent-dialog-actions button").evaluateAll((buttons) => ({
    viewportHeight: window.innerHeight,
    bottoms: buttons.map((button) => Math.round(button.getBoundingClientRect().bottom)),
    dialogBottom: Math.round(document.querySelector(".agent-dialog")!.getBoundingClientRect().bottom),
  }));
  expect(Math.max(...metrics.bottoms)).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(Math.max(...metrics.bottoms)).toBeLessThanOrEqual(metrics.dialogBottom);
});
