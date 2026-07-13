import type { Page } from "@playwright/test";

export async function stubTurnstile(page: Page) {
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
