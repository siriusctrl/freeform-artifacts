import { expect, test } from "@playwright/test";

test("freeform canvas supports pan, zoom, node drag, select, and add artifact", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });

  const stage = page.getByTestId("canvas-stage");
  const grid = page.getByTestId("grid-plane");
  const revenueNode = page.getByTestId("node-node-revenue");
  const probabilityNode = page.getByTestId("node-node-probability");
  const probabilityChart = page.getByTestId("echarts-inflection-probability");

  await expect(stage).toBeVisible();
  await expect(grid).toBeVisible();
  await expect(revenueNode).toBeVisible();
  await expect(probabilityNode).toBeVisible();
  await expect(probabilityChart).toBeVisible();
  await expect(page.getByText("Monthly revenue")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.artifactIds)).toContain(
    "runtime-margin-chart",
  );

  const initial = await page.evaluate(() => window.__FREEFORM_STATE__!);
  const initialGrid = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize };
  });
  expect(initial.snapToGrid).toBe(true);
  expect(initial.snapGridSize).toBe(38);

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
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    const revenue = state.nodes.find((node) => node.id === "node-revenue");
    return revenue ? [revenue.x % state.snapGridSize, revenue.y % state.snapGridSize] : null;
  }).toEqual([0, 0]);
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  const probabilityBox = await probabilityChart.boundingBox();
  expect(probabilityBox).not.toBeNull();

  await page.mouse.move(probabilityBox!.x + 320, probabilityBox!.y + 220);
  await page.mouse.down();
  await page.mouse.move(probabilityBox!.x + 380, probabilityBox!.y + 260, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.nodes.find((node) => node.id === "node-probability")?.x;
  }).not.toBe(initial.nodes.find((node) => node.id === "node-probability")?.x);

  const resizeHandle = page.getByTestId("resize-node-probability");
  await expect(resizeHandle).toBeVisible();
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();

  await page.mouse.move(resizeBox!.x + 8, resizeBox!.y + 8);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + 78, resizeBox!.y + 48, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.nodes.find((node) => node.id === "node-probability")?.width;
  }).toBeGreaterThan(initial.nodes.find((node) => node.id === "node-probability")!.width);
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    const probability = state.nodes.find((node) => node.id === "node-probability");
    return probability ? [probability.width % state.snapGridSize, probability.height % state.snapGridSize] : null;
  }).toEqual([0, 0]);

  await page.getByTestId("snap-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(false);
  await page.getByTestId("snap-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(true);

  const panStart = { x: stageBox!.x + 100, y: stageBox!.y + stageBox!.height - 120 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 120, panStart.y - 80, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return Math.round(state.viewport.x);
  }).not.toBe(Math.round(initial.viewport.x));
  await expect.poll(async () => {
    const style = await grid.evaluate((element) => window.getComputedStyle(element).backgroundPosition);
    return style;
  }).not.toBe(initialGrid.backgroundPosition);

  const beforeWheelPan = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport);
  const beforeWheelGrid = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize };
  });
  await page.mouse.move(stageBox!.x + 650, stageBox!.y + 360);
  await page.mouse.wheel(90, 140);

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return Math.round(state.viewport.x);
  }).toBe(Math.round(beforeWheelPan.x - 90));
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return Math.round(state.viewport.y);
  }).toBe(Math.round(beforeWheelPan.y - 140));
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBe(
    beforeWheelPan.scale,
  );
  await expect.poll(async () => {
    const style = await grid.evaluate((element) => window.getComputedStyle(element).backgroundPosition);
    return style;
  }).not.toBe(beforeWheelGrid.backgroundPosition);
  await expect.poll(async () => {
    const style = await grid.evaluate((element) => window.getComputedStyle(element).backgroundSize);
    return style;
  }).toBe(beforeWheelGrid.backgroundSize);

  await stage.evaluate((element, point) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        ctrlKey: true,
        deltaY: -120,
      }),
    );
  }, { x: stageBox!.x + 650, y: stageBox!.y + 360 });

  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBeGreaterThan(
    beforeWheelPan.scale,
  );
  await expect.poll(async () => {
    const style = await grid.evaluate((element) => window.getComputedStyle(element).backgroundSize);
    return style;
  }).not.toBe(beforeWheelGrid.backgroundSize);

  const scaleAfterPinch = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale);
  await page.getByTestId("zoom-out").click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.viewport.scale;
  }).toBeLessThan(scaleAfterPinch);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");

  await page.getByTestId("import-data").click();
  await expect(page.getByText("$232,400")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.getByTestId("add-artifact").click();
  await expect(page.getByText("AI generated card")).toBeVisible();

  const finalState = await page.evaluate(() => window.__FREEFORM_STATE__!);
  expect(finalState.nodes.length).toBe(initial.nodes.length + 1);
  expect(finalState.selectedNodeId).toMatch(/^node-ai-/);
  expect(finalState.themeMode).toBe("dark");

  await page.reload();
  await expect(page.getByText("AI generated card")).toBeVisible();
  await expect(page.getByText("$232,400")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.storageMode)).toBe("indexeddb");
});

test("each browser gets an isolated local fork that survives closing and reopening the page", async ({ browser }) => {
  const visitorA = await browser.newContext();
  const visitorB = await browser.newContext();

  try {
    const firstPage = await visitorA.newPage();
    await firstPage.goto("/");
    await firstPage.getByTestId("canvas-stage").waitFor({ state: "visible" });
    await expect.poll(async () => firstPage.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");
    await firstPage.getByTestId("add-artifact").click();
    await expect(firstPage.getByText("AI generated card")).toBeVisible();
    await expect.poll(async () => firstPage.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await firstPage.close();

    const reopenedPage = await visitorA.newPage();
    await reopenedPage.goto("/");
    await expect(reopenedPage.getByText("AI generated card")).toBeVisible();
    await expect
      .poll(async () => reopenedPage.evaluate(() => window.__FREEFORM_STATE__!.storageMode))
      .toBe("indexeddb");

    const otherVisitorPage = await visitorB.newPage();
    await otherVisitorPage.goto("/");
    await expect(otherVisitorPage.getByTestId("canvas-stage")).toBeVisible();
    await expect(otherVisitorPage.getByText("AI generated card")).toHaveCount(0);
    await expect.poll(async () => otherVisitorPage.evaluate(() => window.__FREEFORM_STATE__!.storageMode)).toBe(
      "indexeddb",
    );

    const visitorACount = await reopenedPage.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
    const visitorBCount = await otherVisitorPage.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
    expect(visitorACount).toBe(visitorBCount + 1);
  } finally {
    await visitorA.close();
    await visitorB.close();
  }
});

test("workspace backups round-trip through export, reset, and import", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("add-artifact").click();
  await expect(page.getByText("AI generated card")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-workspace").click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("market-overview.freeform.json");
  await download.saveAs(backupPath);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("reset-workspace").click();
  await expect(page.getByText("AI generated card")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.getByTestId("workspace-file").setInputFiles(backupPath);
  await expect(page.getByText("AI generated card")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
});
