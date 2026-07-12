import { expect, test } from "@playwright/test";

test("mobile canvas keeps core controls visible without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas-stage")).toBeVisible();
  await expect(page.getByTestId("build-artifact")).toBeVisible();
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBe(0.48);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  const nodeCount = (await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length;
  await page.getByTestId("build-artifact").click();
  await page.getByTestId("agent-request").fill("A compact regional supply chart");
  await expect(page.getByTestId("agent-instruction")).toContainText("compact regional supply chart");
  const dialogDimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dialogDimensions.scrollWidth).toBeLessThanOrEqual(dialogDimensions.innerWidth);
  expect((await page.evaluate(() => window.__FREEFORM_STATE__!)).nodes.length).toBe(nodeCount);
  await page.getByTitle("Close").click();

  await page.getByTestId("workspace-menu").click();
  await expect(page.getByTestId("snap-toggle")).toContainText("On");
  await expect(page.getByRole("menuitem", { name: "Load sample data" })).toBeVisible();
});
