import { expect, test } from "@playwright/test";

test("mobile canvas keeps core controls visible without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas-stage")).toBeVisible();
  await expect(page.getByTestId("add-artifact")).toBeVisible();
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
  await expect(page.getByTestId("snap-toggle")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.viewport.scale)).toBe(0.48);

  await page.getByTestId("theme-toggle").click();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.themeMode)).toBe("dark");
  await page.getByTestId("add-artifact").click();
  await expect(page.getByText("AI generated card")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
});
