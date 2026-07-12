import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function chartLabelLayout(page: Page, hostTestId: string, labels: string[]) {
  return page.getByTestId(hostTestId).evaluate((host, expectedLabels) => {
    const hostRect = host.getBoundingClientRect();
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = expectedLabels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside =
          rect.left < hostRect.left - 1 ||
          rect.right > hostRect.right + 1 ||
          rect.top < hostRect.top - 1 ||
          rect.bottom > hostRect.bottom + 1;
        return outside
          ? [{ label, host: { left: hostRect.left, right: hostRect.right, top: hostRect.top, bottom: hostRect.bottom }, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }]
          : [];
      }),
    };
  }, labels);
}

async function probabilityNoteLayout(page: Page) {
  return page.getByTestId("echarts-inflection-probability").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    const compact = hostRect.width < 640 || hostRect.height < 400;
    const horizontalPadding = compact ? 18 : 24;
    const noteTop = compact ? 52 : 62;
    const noteHeight = compact ? 90 : 76;
    const panel = {
      left: hostRect.left + horizontalPadding,
      right: hostRect.right - horizontalPadding,
      top: hostRect.top + noteTop,
      bottom: hostRect.top + noteTop + noteHeight,
    };
    const labels = ["What:", "Read:", "Logic:"];
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = labels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      tops: matches.flatMap(({ element }) => element ? [Math.round(element.getBoundingClientRect().top)] : []),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside =
          rect.left < panel.left - 1 ||
          rect.right > panel.right + 1 ||
          rect.top < panel.top - 1 ||
          rect.bottom > panel.bottom + 1;
        return outside ? [{ label, panel, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }] : [];
      }),
    };
  });
}

async function elementSize(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

test("freeform canvas supports spatial editing, AI handoff, and deletion", async ({ page }) => {
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
  await expect(page.getByTitle("Select")).toHaveCount(0);
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
  expect(
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target instanceof Element && Boolean(target.closest(".resize-handle"));
    }, { x: resizeBox!.x + resizeBox!.width / 2, y: resizeBox!.y + resizeBox!.height / 2 }),
  ).toBe(true);

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

  await page.getByTestId("workspace-menu").click();
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("snap-toggle")).toContainText("Snap to grid");
  await page.getByTestId("snap-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(false);
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("snap-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(true);
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("workspace-menu").click();

  const topControlHeights = await page.evaluate(() =>
    ["theme-toggle", "workspace-menu", "board-status", "build-artifact"].map((testId) =>
      Math.round(document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect().height),
    ),
  );
  expect(new Set(topControlHeights)).toEqual(new Set([44]));
  const moreAlignment = await page.getByTestId("workspace-menu").evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const iconRect = button.querySelector("svg")!.getBoundingClientRect();
    return Math.abs(
      (buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2),
    );
  });
  expect(moreAlignment).toBeLessThanOrEqual(0.5);

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
    for (let index = 0; index < 8; index += 1) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          ctrlKey: true,
          deltaY: -4,
        }),
      );
    }
  }, { x: stageBox!.x + 650, y: stageBox!.y + 360 });

  await expect
    .poll(async () =>
      page.evaluate(
        (beforeScale) => window.__FREEFORM_STATE__!.viewport.scale / beforeScale,
        beforeWheelPan.scale,
      ),
    )
    .toBeGreaterThan(1.5);
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

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("import-data").click();
  await expect(page.getByText("$232,400")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  const beforeHandoffCount = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length;
  await page.getByTestId("build-artifact").click();
  await expect(page.getByRole("heading", { name: "Build with AI" })).toBeVisible();
  await page.getByTestId("agent-request").fill("A regional renewable capacity mix chart with quarterly forecasts");
  await expect(page.getByTestId("agent-instruction")).toContainText(
    "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder --agent claude-code -y",
  );
  await expect(page.getByTestId("agent-instruction")).toContainText("regional renewable capacity mix chart");
  await expect(page.getByTestId("copy-agent-instruction")).toBeEnabled();
  expect((await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length).toBe(beforeHandoffCount);
  await page.getByTitle("Close").click();

  await expect(page.getByTestId("delete-node-revenue")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  const finalState = await page.evaluate(() => window.__FREEFORM_STATE__!);
  expect(finalState.nodes.length).toBe(initial.nodes.length - 1);
  expect(finalState.selectedNodeId).toBe("");
  expect(finalState.themeMode).toBe("dark");

  await page.reload();
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.snapToGrid)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.storageMode)).toBe("indexeddb");
});

test("managed charts keep essential labels inside default and minimum card sizes", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });

  await expect.poll(() => chartLabelLayout(page, "echarts-inflection-probability", ["P75"])).toEqual({
    missing: [],
    overflow: [],
  });
  await expect.poll(() => probabilityNoteLayout(page)).toMatchObject({ missing: [], overflow: [] });
  expect(new Set((await probabilityNoteLayout(page)).tops).size).toBe(3);
  await expect(page.getByText(/DRAM/i)).toHaveCount(0);
  await expect.poll(() => chartLabelLayout(page, "echarts-sankey-flow", ["North", "South"])).toEqual({
    missing: [],
    overflow: [],
  });
  await expect(page.locator(".inspector")).toHaveCount(0);

  const undersizedWorkspace = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    return {
      version: 1,
      templateId: state.templateId,
      templateVersion: 1,
      updatedAt: new Date().toISOString(),
      board: {
        version: 1,
        nodes: state.nodes.map((node) =>
          node.id === "node-probability" || node.id === "node-sankey"
            ? { ...node, width: 200, height: 150 }
            : node,
        ),
        viewport: state.viewport,
        selectedNodeId: "",
        themeMode: state.themeMode,
        snapToGrid: state.snapToGrid,
      },
    };
  });
  const undersizedWorkspacePath = testInfo.outputPath("undersized.freeform.json");
  await writeFile(undersizedWorkspacePath, JSON.stringify(undersizedWorkspace));
  await page.getByTestId("workspace-file").setInputFiles(undersizedWorkspacePath);
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__FREEFORM_STATE__!);
    return state.nodes
      .filter((node) => node.id === "node-probability" || node.id === "node-sankey")
      .map((node) => ({ id: node.id, width: node.width, height: node.height }));
  }).toEqual([
    { id: "node-probability", width: 570, height: 418 },
    { id: "node-sankey", width: 532, height: 342 },
  ]);

  const probabilityNode = page.getByTestId("node-node-probability");
  await probabilityNode.click({ position: { x: 120, y: 18 } });
  const probabilityResize = page.getByTestId("resize-node-probability");
  const probabilityResizeBox = await probabilityResize.boundingBox();
  expect(probabilityResizeBox).not.toBeNull();
  await page.mouse.move(
    probabilityResizeBox!.x + probabilityResizeBox!.width / 2,
    probabilityResizeBox!.y + probabilityResizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(probabilityResizeBox!.x - 500, probabilityResizeBox!.y - 400, { steps: 16 });
  await page.mouse.up();

  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
      (candidate) => candidate.id === "node-probability",
    );
    return node ? { width: node.width, height: node.height } : null;
  }).toEqual({ width: 570, height: 418 });
  await expect.poll(() => chartLabelLayout(page, "echarts-inflection-probability", ["P75"])).toEqual({
    missing: [],
    overflow: [],
  });
  await expect.poll(() => probabilityNoteLayout(page)).toMatchObject({ missing: [], overflow: [] });
  expect(new Set((await probabilityNoteLayout(page)).tops).size).toBe(3);

  const stageBox = await page.getByTestId("canvas-stage").boundingBox();
  expect(stageBox).not.toBeNull();
  await page.mouse.move(stageBox!.x + 700, stageBox!.y + 400);
  await page.mouse.wheel(450, 480);
  const sankeyNode = page.getByTestId("node-node-sankey");
  await sankeyNode.click({ position: { x: 120, y: 18 } });
  const sankeyResize = page.getByTestId("resize-node-sankey");
  const sankeyResizeBox = await sankeyResize.boundingBox();
  expect(sankeyResizeBox).not.toBeNull();
  await page.mouse.move(
    sankeyResizeBox!.x + sankeyResizeBox!.width / 2,
    sankeyResizeBox!.y + sankeyResizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(sankeyResizeBox!.x - 400, sankeyResizeBox!.y - 300, { steps: 16 });
  await page.mouse.up();

  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
      (candidate) => candidate.id === "node-sankey",
    );
    return node ? { width: node.width, height: node.height } : null;
  }).toEqual({ width: 532, height: 342 });
  await expect.poll(() => chartLabelLayout(page, "echarts-sankey-flow", ["North", "South"])).toEqual({
    missing: [],
    overflow: [],
  });
});

test("card resize and canvas zoom scale Sankey visuals and selected controls together", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });

  const baseWorkspace = await page.evaluate(() => {
    const state = window.__FREEFORM_STATE__!;
    return {
      version: 1 as const,
      templateId: state.templateId,
      templateVersion: 2,
      updatedAt: new Date().toISOString(),
      board: {
        version: 1 as const,
        nodes: state.nodes,
        viewport: { x: -720, y: -450, scale: 1 },
        selectedNodeId: "node-sankey",
        themeMode: state.themeMode,
        snapToGrid: state.snapToGrid,
      },
    };
  });

  await page.getByTestId("workspace-file").setInputFiles({
    name: "selected-sankey.freeform.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(baseWorkspace)),
  });
  await expect(page.getByTestId("delete-node-sankey")).toBeVisible();
  const sankeyLabelSelector = '[data-testid="echarts-sankey-flow"] svg text';
  const northLabel = page.locator(sankeyLabelSelector).filter({ hasText: "North" }).first();
  await expect(northLabel).toBeVisible();
  const defaultDelete = await elementSize(page, '[data-testid="delete-node-sankey"]');
  const defaultLabel = await northLabel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  const expandedWorkspace = {
    ...baseWorkspace,
    board: {
      ...baseWorkspace.board,
      nodes: baseWorkspace.board.nodes.map((node) =>
        node.id === "node-sankey" ? { ...node, width: 800, height: 480 } : node,
      ),
    },
  };
  await page.getByTestId("workspace-file").setInputFiles({
    name: "expanded-sankey.freeform.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(expandedWorkspace)),
  });
  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
      (candidate) => candidate.id === "node-sankey",
    );
    return node ? [node.width, node.height] : null;
  }).toEqual([800, 480]);
  await expect.poll(async () => (await elementSize(page, '[data-testid="delete-node-sankey"]')).width).toBeGreaterThan(
    defaultDelete.width * 1.25,
  );
  await expect.poll(async () => {
    const rect = await northLabel.evaluate((element) => element.getBoundingClientRect().height);
    return rect;
  }).toBeGreaterThan(defaultLabel.height * 1.2);

  const expandedDelete = await elementSize(page, '[data-testid="delete-node-sankey"]');
  const expandedLabel = await northLabel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const beforeZoomScale = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale);
  await page.getByTestId("zoom-out").click();
  const afterZoomScale = await page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale);
  const zoomRatio = afterZoomScale / beforeZoomScale;
  const zoomedDelete = await elementSize(page, '[data-testid="delete-node-sankey"]');
  const zoomedLabel = await northLabel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  expect(zoomedDelete.width / expandedDelete.width).toBeCloseTo(zoomRatio, 2);
  expect(zoomedLabel.height / expandedLabel.height).toBeCloseTo(zoomRatio, 1);
});

test("each browser gets an isolated local fork that survives closing and reopening the page", async ({ browser }) => {
  const visitorA = await browser.newContext();
  const visitorB = await browser.newContext();

  try {
    const firstPage = await visitorA.newPage();
    await firstPage.goto("/");
    await firstPage.getByTestId("canvas-stage").waitFor({ state: "visible" });
    await expect.poll(async () => firstPage.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");
    await firstPage.getByTestId("node-node-revenue").click({ position: { x: 100, y: 18 } });
    await firstPage.getByTestId("delete-node-revenue").click();
    await expect(firstPage.getByTestId("node-node-revenue")).toHaveCount(0);
    await expect.poll(async () => firstPage.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await firstPage.close();

    const reopenedPage = await visitorA.newPage();
    await reopenedPage.goto("/");
    await expect(reopenedPage.getByTestId("node-node-revenue")).toHaveCount(0);
    await expect
      .poll(async () => reopenedPage.evaluate(() => window.__FREEFORM_STATE__!.storageMode))
      .toBe("indexeddb");

    const otherVisitorPage = await visitorB.newPage();
    await otherVisitorPage.goto("/");
    await expect(otherVisitorPage.getByTestId("canvas-stage")).toBeVisible();
    await expect(otherVisitorPage.getByTestId("node-node-revenue")).toBeVisible();
    await expect.poll(async () => otherVisitorPage.evaluate(() => window.__FREEFORM_STATE__!.storageMode)).toBe(
      "indexeddb",
    );

    const visitorACount = await reopenedPage.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
    const visitorBCount = await otherVisitorPage.evaluate(() => window.__FREEFORM_STATE__!.nodes.length);
    expect(visitorACount).toBe(visitorBCount - 1);
  } finally {
    await visitorA.close();
    await visitorB.close();
  }
});

test("workspace backups round-trip through export, reset, and import", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await page.getByTestId("node-node-revenue").click({ position: { x: 100, y: 18 } });
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("export-workspace").click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("market-overview.freeform.json");
  await download.saveAs(backupPath);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("reset-workspace").click();
  await expect(page.getByTestId("node-node-revenue")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.getByTestId("workspace-file").setInputFiles(backupPath);
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
});
