import { expect, test } from "@playwright/test";
import { stubTurnstile } from "./helpers/relay";

test("mobile canvas keeps core controls visible without horizontal overflow", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto("/");
  await expect(page.getByTestId("canvas-stage")).toBeVisible();
  await expect(page.getByTestId("artifact-library-toggle")).toBeVisible();
  await expect(page.getByTestId("build-artifact")).toBeVisible();
  await expect(page.getByTestId("build-artifact")).toHaveAccessibleName("Build with AI");
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
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
  await expect(page.getByTestId("agent-instruction")).toContainText("ask the user what they want to build");
  await expect(page.getByTestId("agent-instruction")).toContainText("Delivery mode: BROWSER_RELAY");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  const dialogDimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dialogDimensions.scrollWidth).toBeLessThanOrEqual(dialogDimensions.innerWidth);
  expect((await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length).toBe(nodeCount);
  await page.getByTitle("Close", { exact: true }).click();
  const sessionIndicator = page.getByTestId("relay-session-indicator");
  await expect(sessionIndicator).toBeVisible();
  const indicatorBounds = await sessionIndicator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(indicatorBounds.left).toBeGreaterThanOrEqual(0);
  expect(indicatorBounds.right).toBeLessThanOrEqual(indicatorBounds.viewport);

  await page.getByTestId("artifact-library-toggle").click();
  await expect(page.getByTestId("artifact-library")).toBeVisible();
  await expect(sessionIndicator).toBeVisible();
  await expect(sessionIndicator.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(sessionIndicator.getByRole("button", { name: "End" })).toBeVisible();
  const libraryOverlap = await page.evaluate(() => {
    const indicator = document.querySelector<HTMLElement>('[data-testid="relay-session-indicator"]')!.getBoundingClientRect();
    const footer = document.querySelector<HTMLElement>(".artifact-library-footer")!.getBoundingClientRect();
    return indicator.left < footer.right && indicator.right > footer.left && indicator.top < footer.bottom && indicator.bottom > footer.top;
  });
  expect(libraryOverlap).toBe(false);
  await page.getByTitle("Close artifacts").click();

  await page.getByTestId("workspace-menu").click();
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitem", { name: "Load sample data" })).toBeVisible();
  await page.getByTestId("workspace-menu").click();

  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("canvas-sidebar")).toBeVisible();
  await expect(page.getByTestId("close-views")).toBeVisible();
  await page.getByTestId("close-views").click();
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();
  await page.getByTestId("sidebar-toggle").click();
  await page.locator(".sidebar-backdrop").click({ position: { x: 400, y: 400 } });
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("enter-presentation").click();
  await expect(page.getByTestId("presentation-controls")).toBeVisible();
  await expect(sessionIndicator).toBeVisible();
  await expect(sessionIndicator.getByRole("button", { name: "Open" })).toBeVisible();
  const presentationOverlap = await page.evaluate(() => {
    const indicator = document.querySelector<HTMLElement>('[data-testid="relay-session-indicator"]')!.getBoundingClientRect();
    const controls = document.querySelector<HTMLElement>('[data-testid="presentation-controls"]')!.getBoundingClientRect();
    return indicator.left < controls.right && indicator.right > controls.left && indicator.top < controls.bottom && indicator.bottom > controls.top;
  });
  expect(presentationOverlap).toBe(false);
  await page.getByTestId("exit-presentation").click();
  await expect(page.getByTestId("canvas-stage")).toBeVisible();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
});

test("short landscape keeps every Build Session action reachable", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await stubTurnstile(page);
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("artifact-tab-personal").click();
  await page.getByTestId("library-build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
  await expect(page.getByTestId("relay-session-status").locator("time")).toBeVisible();
  const metrics = await page.locator(".agent-dialog-actions button").evaluateAll((buttons) => ({
    viewportHeight: window.innerHeight,
    bottoms: buttons.map((button) => Math.round(button.getBoundingClientRect().bottom)),
    dialogBottom: Math.round(document.querySelector(".agent-dialog")!.getBoundingClientRect().bottom),
  }));
  expect(Math.max(...metrics.bottoms)).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(Math.max(...metrics.bottoms)).toBeLessThanOrEqual(metrics.dialogBottom);
});

test("phone overlays trap focus and restore it after view and presentation changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubTurnstile(page);
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  expect(await page.getByTestId("workspace-file").getAttribute("tabindex")).toBe("-1");

  await page.getByTestId("artifact-library-toggle").click();
  await expect(page.getByTitle("Close artifacts")).toBeFocused();
  expect(await page.locator(".workspace").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await page.getByTestId("library-build-artifact").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTitle("Close artifacts")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("artifact-library-toggle")).toBeFocused();
  await page.getByTestId("artifact-library-toggle").click();
  await page.getByTestId("library-build-artifact").click();
  await expect(page.getByTestId("relay-session-status")).toContainText("Live delivery ready");
  await expect(page.getByTitle("Close", { exact: true })).toBeFocused();
  expect(await page.locator(".workspace").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  expect(await page.locator(".canvas-sidebar-slot").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  expect(await page.locator(".artifact-library-slot").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expect(page.getByText("Start with your agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Copy the instruction", { exact: true })).toBeVisible();
  await expect(page.locator(".agent-handoff-details")).not.toHaveAttribute("open", "");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("copy-agent-instruction")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTitle("Close", { exact: true })).toBeFocused();
  await page.getByTitle("Close", { exact: true }).click();
  await expect(page.getByTestId("artifact-library-toggle")).toBeFocused();

  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("view-market-overview")).toBeFocused();
  expect(await page.locator(".workspace").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  const lastSidebarControl = page.getByTestId("view-menu-market-overview");
  await lastSidebarControl.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("create-view")).toBeFocused();
  await page.getByTestId("create-view").click();
  await expect(page.getByTestId("canvas-stage")).toBeFocused();
  const createdId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);

  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId(`view-menu-${createdId}`).click();
  await page.getByTestId(`delete-view-${createdId}`).click();
  await expect(page.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" })).toBeFocused();
  await page.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("enter-presentation").click();
  await expect(page.getByTestId("exit-presentation")).toBeVisible();
  await page.getByTestId("exit-presentation").click();
  await expect(page.getByTestId("canvas-stage")).toBeFocused();
});
