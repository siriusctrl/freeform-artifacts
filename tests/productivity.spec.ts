import { expect, test, type Page } from "@playwright/test";

async function nodePositions(page: Page, nodeIds: string[]) {
  const positions = await page.evaluate(() => Object.fromEntries(
    window.__FREEFORM_STATE__!.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  ));
  return Object.fromEntries(nodeIds.map((id) => [id, positions[id]]));
}

test("multi-select edits are transactional and support layout, clipboard, undo, and redo", async ({ page }) => {
  await page.goto("/");
  const stage = page.getByTestId("canvas-stage");
  await stage.waitFor({ state: "visible" });

  const stageBox = await stage.boundingBox();
  expect(stageBox).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(stageBox!.x + 100, stageBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(stageBox!.x + 1180, stageBox!.y + 560, { steps: 10 });
  await expect(page.getByTestId("selection-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.selectedNodeIds.length)).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  await page.getByTestId("node-node-probability").click({ position: { x: 120, y: 16 }, modifiers: ["Shift"] });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.selectedNodeIds)).toEqual([
    "node-revenue",
    "node-probability",
  ]);

  const selectedIds = ["node-revenue", "node-probability"];
  const beforeDrag = await nodePositions(page, selectedIds);
  const revenueBox = await page.getByTestId("node-node-revenue").boundingBox();
  expect(revenueBox).not.toBeNull();
  await page.mouse.move(revenueBox!.x + 90, revenueBox!.y + 16);
  await page.mouse.down();
  await page.mouse.move(revenueBox!.x + 210, revenueBox!.y + 92, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await nodePositions(page, selectedIds);
  expect(afterDrag["node-revenue"].x - beforeDrag["node-revenue"].x).toBe(
    afterDrag["node-probability"].x - beforeDrag["node-probability"].x,
  );
  expect(afterDrag["node-revenue"].y - beforeDrag["node-revenue"].y).toBe(
    afterDrag["node-probability"].y - beforeDrag["node-probability"].y,
  );

  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  await page.keyboard.press("Meta+z");
  await expect.poll(() => nodePositions(page, selectedIds)).toEqual(beforeDrag);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => nodePositions(page, selectedIds)).toEqual(afterDrag);

  await page.getByTestId("layout-align-left").click();
  await expect.poll(async () => {
    const positions = await nodePositions(page, selectedIds);
    return [positions["node-revenue"].x, positions["node-probability"].x];
  }).toEqual([afterDrag["node-revenue"].x, afterDrag["node-revenue"].x]);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => nodePositions(page, selectedIds)).toEqual(afterDrag);

  await page.getByTestId("node-node-table").click({ position: { x: 90, y: 16 }, modifiers: ["Shift"] });
  await page.getByTestId("layout-distribute-horizontal").click();
  await expect.poll(async () => page.evaluate(() => {
    const selectedIds = new Set(window.__FREEFORM_STATE__!.selectedNodeIds);
    const selected = window.__FREEFORM_STATE__!.nodes
      .filter((node) => selectedIds.has(node.id))
      .sort((first, second) => first.x - second.x);
    const gaps = selected.slice(1).map((node, index) => node.x - (selected[index].x + selected[index].width));
    return Math.max(...gaps) - Math.min(...gaps);
  })).toBeLessThanOrEqual(1);
  await page.keyboard.press("Meta+z");
  await page.getByTestId("node-node-table").click({ position: { x: 90, y: 16 }, modifiers: ["Shift"] });

  const initialCount = await page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
  await page.keyboard.press("Meta+d");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 2);
  await page.keyboard.press("Meta+c");
  await page.keyboard.press("Meta+v");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 4);
  await page.keyboard.press("Delete");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 2);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(initialCount + 4);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.canRedo)).toBe(true);
});

test("views can be duplicated, reordered, deleted with undo, and presented without mutating the viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Scenario lab");
  await page.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
  const scenarioId = await page.evaluate(() => window.__FREEFORM_STATE__!.templateId);

  await page.getByTestId("view-market-overview").click();
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Live market");
  await page.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saving locally");
  await page.getByTestId("view-menu-market-overview").click();
  await page.getByTestId("duplicate-view-market-overview").click();
  await expect(page.getByTestId("canvas-title")).toHaveText("Live market copy");
  const duplicateId = await page.evaluate(() => window.__FREEFORM_STATE__!.templateId);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(5);

  const duplicateItem = page.locator(`[data-view-id="${duplicateId}"]`);
  const marketItem = page.locator('[data-view-id="market-overview"]');
  await duplicateItem.dragTo(marketItem);
  await expect.poll(async () => page.locator(".view-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-view-id")))).toEqual([
    duplicateId,
    "market-overview",
    scenarioId,
  ]);
  await duplicateItem.dragTo(marketItem);
  await expect.poll(async () => page.locator(".view-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-view-id")))).toEqual([
    "market-overview",
    duplicateId,
    scenarioId,
  ]);
  await page.getByTestId(`view-menu-${duplicateId}`).click();
  await page.getByTestId(`move-view-up-${duplicateId}`).click();
  await expect.poll(async () => page.locator(".view-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-view-id")))).toEqual([
    duplicateId,
    "market-overview",
    scenarioId,
  ]);
  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await expect.poll(async () => page.locator(".view-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-view-id")))).toEqual([
    duplicateId,
    "market-overview",
    scenarioId,
  ]);

  await page.getByTestId(`view-${duplicateId}`).click();
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Transient duplicate");
  await page.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saving locally");
  await page.getByTestId(`view-menu-${duplicateId}`).click();
  await page.getByTestId(`delete-view-${duplicateId}`).click();
  await expect(page.getByTestId("view-undo-toast")).toBeVisible();
  await expect(page.locator(`[data-view-id="${duplicateId}"]`)).toHaveCount(0);
  await page.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.locator(`[data-view-id="${duplicateId}"]`)).toHaveCount(1);

  await page.getByTestId(`view-${duplicateId}`).click();
  await expect(page.getByTestId("canvas-title")).toHaveText("Transient duplicate");
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("node-node-revenue").click({ position: { x: 90, y: 16 } });
  const selectionBefore = await page.evaluate(() => window.__FREEFORM_STATE__!.selectedNodeIds);
  const viewportBefore = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport);
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("enter-presentation").click();
  await expect(page.locator(".topbar")).not.toBeVisible();
  await expect(page.locator(".zoom-controls")).toHaveCount(0);
  await expect(page.locator(".node-chrome").first()).not.toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.presentationMode)).toBe(true);
  const containment = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".canvas-node")].every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= stage.left - 1 && rect.right <= stage.right + 1 && rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1;
    });
  });
  expect(containment).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.selectedNodeIds)).toEqual(selectionBefore);
  await page.getByTestId("exit-presentation").click();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport)).toEqual(viewportBefore);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.selectedNodeIds)).toEqual(selectionBefore);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("enter-presentation").click();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe(scenarioId);
  await expect(page.locator(".topbar")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).toBeVisible();
});

test("deleted views stay hidden when IndexedDB deletion is temporarily unavailable", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await page.getByTestId("create-view").click();
  const disposableId = await page.evaluate(() => window.__FREEFORM_STATE__!.templateId);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
  await page.getByTestId("view-market-overview").click();

  await page.evaluate(() => {
    const prototype = IDBObjectStore.prototype as IDBObjectStore & { __originalDelete?: IDBObjectStore["delete"] };
    prototype.__originalDelete = prototype.delete;
    prototype.delete = function unavailableDelete() {
      throw new DOMException("Temporarily unavailable", "InvalidStateError");
    };
  });
  await page.getByTestId(`view-menu-${disposableId}`).click();
  await page.getByTestId(`delete-view-${disposableId}`).click();
  await expect(page.locator(`[data-view-id="${disposableId}"]`)).toHaveCount(0);
  await page.evaluate(() => {
    const prototype = IDBObjectStore.prototype as IDBObjectStore & { __originalDelete?: IDBObjectStore["delete"] };
    if (prototype.__originalDelete) prototype.delete = prototype.__originalDelete;
    delete prototype.__originalDelete;
  });

  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.locator(`[data-view-id="${disposableId}"]`)).toHaveCount(0);
});
