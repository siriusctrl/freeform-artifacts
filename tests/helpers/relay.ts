import type { Page } from "@playwright/test";

export async function stubTurnstile(page: Page) {
  // CI sends independent browser contexts through one loopback address. Give
  // each page its own documentation-range source IP so the browser suite models
  // separate clients; the Worker adversarial suite tests shared-IP exhaustion.
  const sourceSegment = crypto.randomUUID().replaceAll("-", "").slice(0, 4);
  const sourceIp = `2001:db8:${sourceSegment}::1`;
  await page.route(/\/v1\/sessions$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        "CF-Connecting-IP": sourceIp,
      },
    });
  });
  await page.addInitScript(() => {
    let callback: ((token: string) => void) | undefined;
    window.turnstile = {
      render: (_container, options) => {
        callback = options.callback;
        return "playwright-turnstile";
      },
      execute: () => {
        window.setTimeout(() => callback?.("test-turnstile-pass"), 0);
      },
      remove: () => {
        callback = undefined;
      },
    };
  });
}
