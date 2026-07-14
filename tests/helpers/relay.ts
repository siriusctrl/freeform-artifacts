import type { Page } from "@playwright/test";

interface StubTurnstileOptions {
  autoComplete?: boolean;
  focusableChallenge?: boolean;
  sessionCreationGate?: Promise<void>;
}

export async function stubTurnstile(
  page: Page,
  {
    autoComplete = true,
    focusableChallenge = false,
    sessionCreationGate,
  }: StubTurnstileOptions = {},
) {
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
    await sessionCreationGate;
    await route.continue({
      headers: {
        ...route.request().headers(),
        "CF-Connecting-IP": sourceIp,
      },
    });
  });
  await page.addInitScript(({ autoComplete, focusableChallenge }) => {
    let callback: ((token: string) => void) | undefined;
    let challenge: HTMLIFrameElement | undefined;
    const probe = window as typeof window & {
      __completeTestTurnstile?: () => void;
      __turnstileRenderOptions?: { size?: string; theme?: string };
    };
    window.turnstile = {
      render: (container, options) => {
        callback = options.callback;
        probe.__turnstileRenderOptions = { size: options.size, theme: options.theme };
        if (focusableChallenge && container instanceof HTMLElement) {
          challenge = document.createElement("iframe");
          challenge.dataset.testid = "turnstile-challenge-frame";
          challenge.title = "Cloudflare security challenge";
          challenge.srcdoc = "<!doctype html><title>Cloudflare security challenge</title><button>Verify</button>";
          challenge.style.width = "100%";
          challenge.style.height = "65px";
          challenge.style.border = "0";
          container.append(challenge);
        }
        return "playwright-turnstile";
      },
      execute: () => {
        if (autoComplete) window.setTimeout(() => callback?.("test-turnstile-pass"), 0);
      },
      remove: () => {
        callback = undefined;
        challenge?.remove();
        challenge = undefined;
      },
    };
    probe.__completeTestTurnstile = () => callback?.("test-turnstile-pass");
  }, { autoComplete, focusableChallenge });
}
