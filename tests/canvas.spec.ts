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
    const objectScale = hostRect.width / host.clientWidth;
    const compact = host.clientWidth < 640 || host.clientHeight < 400;
    const horizontalPadding = compact ? 18 : 24;
    const noteTop = compact ? 52 : 62;
    const noteHeight = compact ? 90 : 76;
    const panel = {
      left: hostRect.left + horizontalPadding * objectScale,
      right: hostRect.right - horizontalPadding * objectScale,
      top: hostRect.top + noteTop * objectScale,
      bottom: hostRect.top + (noteTop + noteHeight) * objectScale,
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

async function sankeyNodeColors(page: Page) {
  return page.getByTestId("echarts-sankey-flow").locator("svg").evaluate((svg) =>
    [...svg.querySelectorAll("path")]
      .map((path) => path.getAttribute("fill"))
      .filter((fill): fill is string => Boolean(fill && fill !== "none" && !fill.startsWith("url") && fill !== "rgb(0,0,0)")),
  );
}

async function pipelineConnectorGeometry(page: Page) {
  return page.locator(".flow-grid").evaluate((grid) => {
    const connector = grid.querySelector<HTMLElement>(".flow-connector")!.getBoundingClientRect();
    const markers = [...grid.querySelectorAll<HTMLElement>(".flow-step-node")].map((marker) => marker.getBoundingClientRect());
    return {
      connectorLeft: connector.left,
      connectorRight: connector.right,
      firstCenter: markers[0].left + markers[0].width / 2,
      lastCenter: markers.at(-1)!.left + markers.at(-1)!.width / 2,
    };
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

  const probabilityDeleteBefore = await elementSize(page, '[data-testid="delete-node-probability"]');
  const probabilityMarker = probabilityChart.locator("svg text").filter({ hasText: "P75:" }).first();
  const probabilityMarkerBefore = await probabilityMarker.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const probabilitySizeBefore = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
    (node) => node.id === "node-probability",
  )!;

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
    return probability ? probability.width / probability.height : null;
  }).toBeCloseTo(720 / 460, 4);
  const probabilitySizeAfter = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
    (node) => node.id === "node-probability",
  )!;
  const resizeScale = probabilitySizeAfter.width / probabilitySizeBefore.width;
  const probabilityDeleteAfter = await elementSize(page, '[data-testid="delete-node-probability"]');
  const probabilityMarkerAfter = await probabilityMarker.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(probabilityDeleteAfter.width / probabilityDeleteBefore.width).toBeCloseTo(resizeScale, 2);
  expect(probabilityMarkerAfter.height / probabilityMarkerBefore.height).toBeCloseTo(resizeScale, 1);

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

  const topbarMetrics = await page.evaluate(() => ({
    topbar: Math.round(document.querySelector(".topbar")!.getBoundingClientRect().height),
    toolStrip: Math.round(document.querySelector(".tool-strip")!.getBoundingClientRect().height),
    theme: Math.round(document.querySelector('[data-testid="theme-toggle"]')!.getBoundingClientRect().height),
    more: Math.round(document.querySelector('[data-testid="workspace-menu"]')!.getBoundingClientRect().height),
    status: Math.round(document.querySelector('[data-testid="board-status"]')!.getBoundingClientRect().height),
    build: Math.round(document.querySelector('[data-testid="build-artifact"]')!.getBoundingClientRect().height),
    brandFont: getComputedStyle(document.querySelector(".title-block")!).fontFamily,
    fontLoaded: document.fonts.check('16px "Instrument Sans Variable"'),
  }));
  expect(topbarMetrics).toMatchObject({ topbar: 54, toolStrip: 36, theme: 30, more: 30, status: 34, build: 38 });
  expect(topbarMetrics.brandFont).toContain("Instrument Sans Variable");
  expect(topbarMetrics.fontLoaded).toBe(true);
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
  await expect(page.getByTestId("agent-request")).toHaveCount(0);
  await expect(page.getByTestId("agent-instruction")).toContainText(
    "Install the project artifact skill for your agent:",
  );
  await expect(page.getByTestId("agent-instruction")).toContainText(
    "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder",
  );
  await expect(page.getByTestId("agent-instruction")).toContainText("ask the user what artifact they want to build");
  await expect(page.getByTestId("agent-instruction")).not.toContainText("Claude Code");
  await expect(page.getByTestId("agent-instruction")).toContainText("window.__FREEFORM_AGENT__.installArtifact");
  await expect(page.getByTestId("agent-instruction")).toContainText("Do not modify, commit, or deploy");
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
  await expect(page.getByText(/^[a-z]+_[a-z_]+$/)).toHaveCount(0);
  await expect(page.locator(".table-title, .flow-step-index, .flow-rail")).toHaveCount(0);
  await expect(page.locator(".flow-step")).toHaveCount(3);
  const flowStepWidths = await page.locator(".flow-step").evaluateAll((steps) =>
    steps.map((step) => step.getBoundingClientRect().width),
  );
  expect(flowStepWidths.every((width) => width >= 140)).toBe(true);
  const connectorGeometry = await pipelineConnectorGeometry(page);
  expect(connectorGeometry.connectorLeft).toBeCloseTo(connectorGeometry.firstCenter, 0);
  expect(connectorGeometry.connectorRight).toBeCloseTo(connectorGeometry.lastCenter, 0);
  await expect.poll(() => chartLabelLayout(page, "echarts-sankey-flow", ["North", "South"])).toEqual({
    missing: [],
    overflow: [],
  });
  expect(new Set(await sankeyNodeColors(page))).toEqual(new Set([
    "#0891b2",
    "#0f766e",
    "#ca8a04",
    "#2563eb",
    "#dc5a5f",
    "#78716c",
  ]));
  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  expect(new Set(await sankeyNodeColors(page))).toEqual(new Set([
    "#22d3ee",
    "#2dd4bf",
    "#facc15",
    "#60a5fa",
    "#fb7185",
    "#a8a29e",
  ]));
  await expect(page.getByText("Supply-demand probability", { exact: true })).toBeVisible();
  const chartTitleFont = await page.getByTestId("echarts-inflection-probability").locator("svg text").filter({ hasText: "Supply-demand probability" }).first().evaluate((element) => getComputedStyle(element).fontFamily);
  expect(chartTitleFont).toContain("Instrument Sans Variable");
  await expect(page.getByText("Rows to artifact", { exact: true })).toBeVisible();
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
    { id: "node-probability", width: 654.26, height: 418 },
    { id: "node-sankey", width: 570, height: 342 },
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
  }).toEqual({ width: 654.26, height: 418 });
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
  }).toEqual({ width: 570, height: 342 });
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
  const sankeyHost = page.getByTestId("echarts-sankey-flow");
  const defaultHost = await sankeyHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  const sankeyResize = page.getByTestId("resize-node-sankey");
  const sankeyResizeBox = await sankeyResize.boundingBox();
  expect(sankeyResizeBox).not.toBeNull();
  const resizeStart = {
    x: sankeyResizeBox!.x + sankeyResizeBox!.width / 2,
    y: sankeyResizeBox!.y + sankeyResizeBox!.height / 2,
  };
  await page.mouse.move(resizeStart.x, resizeStart.y);
  await page.mouse.down();
  await page.mouse.move(resizeStart.x + 200, resizeStart.y + 120, { steps: 18 });
  await page.mouse.up();
  await expect.poll(async () => {
    const node = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.find(
      (candidate) => candidate.id === "node-sankey",
    );
    return node ? [Math.round(node.width), Math.round(node.height)] : null;
  }).toEqual([800, 480]);
  const expandedHost = await sankeyHost.evaluate((element) => ({
    clientWidth: element.clientWidth,
    screenWidth: element.getBoundingClientRect().width,
  }));
  expect(expandedHost.clientWidth).toBe(defaultHost.clientWidth);
  expect(expandedHost.screenWidth / defaultHost.screenWidth).toBeCloseTo(800 / 600, 2);

  const expandedDelete = await elementSize(page, '[data-testid="delete-node-sankey"]');
  const expandedLabel = await northLabel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const objectScale = expandedHost.screenWidth / defaultHost.screenWidth;
  expect(expandedDelete.width / defaultDelete.width).toBeCloseTo(objectScale, 2);
  expect(expandedLabel.height / defaultLabel.height).toBeCloseTo(objectScale, 1);
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

test("pinch zoom keeps the pointer anchor stable with the views sidebar closed and open", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });

  async function pointerAnchorDrift() {
    const before = await page.getByTestId("canvas-stage").evaluate((stage) => {
      const rect = stage.getBoundingClientRect();
      const point = {
        x: Math.round(rect.left + rect.width * 0.68),
        y: Math.round(rect.top + rect.height * 0.41),
      };
      const local = { x: point.x - rect.left, y: point.y - rect.top };
      const viewport = window.__FREEFORM_STATE__!.viewport;
      return {
        local,
        point,
        scale: viewport.scale,
        world: {
          x: (local.x - viewport.x) / viewport.scale,
          y: (local.y - viewport.y) / viewport.scale,
        },
      };
    });
    await page.getByTestId("canvas-stage").evaluate((stage, point) => {
      stage.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        ctrlKey: true,
        deltaY: -12,
      }));
    }, before.point);
    await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBeGreaterThan(before.scale);
    return page.evaluate(({ local, world }) => {
      const after = window.__FREEFORM_STATE__!.viewport;
      const afterWorld = {
        x: (local.x - after.x) / after.scale,
        y: (local.y - after.y) / after.scale,
      };
      return {
        drift: Math.hypot(afterWorld.x - world.x, afterWorld.y - world.y),
        scaleChanged: true,
      };
    }, before);
  }

  const closedResult = await pointerAnchorDrift();
  expect(closedResult.scaleChanged).toBe(true);
  expect(closedResult.drift).toBeLessThan(0.000001);
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("canvas-sidebar")).toBeVisible();
  await page.waitForTimeout(400);
  const openResult = await pointerAnchorDrift();
  expect(openResult.scaleChanged).toBe(true);
  expect(openResult.drift).toBeLessThan(0.000001);
});

test("named canvas views can be created, renamed, switched, and restored", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();
  await expect(page.locator(".canvas-sidebar-slot")).toHaveAttribute("inert", "");
  await expect(page.getByTestId("canvas-title")).toHaveText("Market overview");

  await page.getByTestId("canvas-title").focus();
  await page.getByTestId("canvas-title").press("F2");
  await expect(page.getByTestId("canvas-title-input")).toBeVisible();
  await page.getByTestId("canvas-title-input").press("Escape");

  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Energy room");
  await page.getByTestId("canvas-title-input").press("Enter");
  await expect(page.getByTestId("canvas-title")).toHaveText("Energy room");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("canvas-sidebar")).toBeVisible();
  await expect(page.getByTestId("canvas-sidebar").getByText("Views", { exact: true })).toBeVisible();
  await expect(page.getByTestId("view-market-overview")).toContainText("Energy room");
  await expect(page.getByTestId("view-market-overview").getByText("Energy room", { exact: true })).toBeVisible();
  await expect(page.getByTestId("view-preview-market-overview").locator(".view-preview-node")).toHaveCount(5);
  await page.getByTestId("create-view").click();
  await expect(page.getByTestId("canvas-title")).toHaveText("Untitled canvas");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_AGENT__?.activeViewId)).not.toBe("market-overview");

  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill("Scenario lab");
  await page.getByTestId("canvas-title-input").press("Enter");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
  const activeViewId = await page.evaluate(() => window.__FREEFORM_AGENT__!.activeViewId);
  expect(activeViewId).not.toBe("market-overview");
  await expect(page.getByTestId(`view-preview-${activeViewId}`).locator(".view-preview-node")).toHaveCount(0);

  await page.getByTestId("view-market-overview").click();
  await expect(page.getByTestId("canvas-title")).toHaveText("Energy room");
  await expect(page.getByTestId("node-node-revenue")).toBeVisible();
  await page.getByTestId(`view-${activeViewId}`).click();
  await expect(page.getByTestId("canvas-title")).toHaveText("Scenario lab");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.nodes.length)).toBe(0);

  await page.reload();
  await expect(page.getByTestId("canvas-title")).toHaveText("Scenario lab");
  await expect(page.getByTestId("canvas-sidebar")).not.toBeVisible();
});

test("published example migration refreshes copy without replacing personal layout", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  const movedX = await page.evaluate(async () => {
    const state = window.__FREEFORM_STATE__!;
    const nextX = state.nodes.find((node) => node.id === "node-probability")!.x + 38;
    const workspace = {
      version: 1,
      templateId: "market-overview",
      title: "Market overview",
      templateVersion: 2,
      updatedAt: new Date(Date.now() + 10_000).toISOString(),
      board: {
        version: 1,
        nodes: state.nodes
          .filter((node) => node.id !== "node-revenue")
          .map((node) => {
            if (node.id === "node-probability") return { ...node, x: nextX, title: "Old model", data: { ...(node.data as object), title: "Old probability" } };
            if (node.id === "node-flow") return { ...node, data: { ...(node.data as object), title: "Old pipeline" } };
            if (node.id === "node-sankey") return { ...node, data: { ...(node.data as object), title: "Old allocation" } };
            return node;
          }),
        viewport: state.viewport,
        selectedNodeId: "",
        themeMode: state.themeMode,
        snapToGrid: state.snapToGrid,
      },
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("workspaces", "readwrite");
      transaction.objectStore("workspaces").put(workspace);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return nextX;
  });

  await page.reload();
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect(page.getByTestId("node-node-revenue")).toHaveCount(0);
  const migrated = await page.evaluate(async () => {
    const nodes = window.__FREEFORM_STATE__!.nodes;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freeform-artifacts", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const workspace = await new Promise<any>((resolve, reject) => {
      const request = database.transaction("workspaces", "readonly").objectStore("workspaces").get("market-overview");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      templateVersion: workspace.templateVersion,
      probability: nodes.find((node) => node.id === "node-probability"),
      flow: nodes.find((node) => node.id === "node-flow"),
      sankey: nodes.find((node) => node.id === "node-sankey"),
    };
  });
  expect(migrated.templateVersion).toBe(3);
  expect(migrated.probability).toMatchObject({ x: movedX, title: "Supply Model", data: { title: "Supply-demand probability" } });
  expect(migrated.flow).toMatchObject({ data: { title: "Rows to artifact" } });
  expect(migrated.sankey).toMatchObject({ data: { title: "Supply allocation" } });
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
    await expect.poll(async () => firstPage.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saving locally");
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
