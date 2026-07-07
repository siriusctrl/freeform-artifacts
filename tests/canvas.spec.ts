import { expect, test } from "@playwright/test";

test("freeform canvas supports pan, zoom, node drag, select, and add artifact", async ({ page }) => {
  await page.goto("/");

  const stage = page.getByTestId("canvas-stage");
  const revenueNode = page.getByTestId("node-node-revenue");

  await expect(stage).toBeVisible();
  await expect(revenueNode).toBeVisible();
  await expect(page.getByText("Monthly revenue")).toBeVisible();

  const initial = await page.evaluate(() => window.__FREEFORM_STATE__!);

  const stageBox = await stage.boundingBox();
  const nodeBox = await revenueNode.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(nodeBox).not.toBeNull();

  await page.mouse.move(nodeBox!.x + 80, nodeBox!.y + 22);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + 190, nodeBox!.y + 84, { steps: 8 });
  await page.mouse.move(nodeBox!.x + 250, nodeBox!.y + 120, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.nodes.find((node) => node.id === "node-revenue")?.x;
  }).not.toBe(initial.nodes.find((node) => node.id === "node-revenue")?.x);
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.mouse.move(stageBox!.x + 820, stageBox!.y + 570);
  await page.mouse.down();
  await page.mouse.move(stageBox!.x + 700, stageBox!.y + 490, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return Math.round(state.viewport.x);
  }).not.toBe(Math.round(initial.viewport.x));

  await page.mouse.move(stageBox!.x + 650, stageBox!.y + 360);
  await page.mouse.wheel(0, -420);

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.viewport.scale;
  }).toBeGreaterThan(initial.viewport.scale);

  const scaleAfterWheel = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale);
  await page.getByTestId("zoom-out").click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.viewport.scale;
  }).toBeLessThan(scaleAfterWheel);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");

  await page.getByTestId("toggle-sidebar").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.sidebarOpen)).toBe(false);
  await page.getByTestId("toggle-sidebar").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.sidebarOpen)).toBe(true);

  await page.getByTestId("add-artifact").click();
  await expect(page.getByText("AI generated card")).toBeVisible();

  const finalState = await page.evaluate(() => window.__FREEFORM_STATE__!);
  expect(finalState.nodes.length).toBe(4);
  expect(finalState.selectedNodeId).toMatch(/^node-ai-/);
  expect(finalState.themeMode).toBe("dark");
  expect(finalState.sidebarOpen).toBe(true);
});

test("sidebar can reopen on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 820 });
  await page.goto("/");

  await page.getByTestId("collapse-sidebar").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.sidebarOpen)).toBe(false);

  await page.getByTestId("open-sidebar").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.sidebarOpen)).toBe(true);
  await expect(page.getByText("Artifact Canvas")).toBeVisible();
});
