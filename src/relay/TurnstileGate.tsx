import { useEffect, useRef } from "react";
import { RELAY_TURNSTILE_ACTION } from "./config";

const TURNSTILE_SCRIPT_ID = "freeform-turnstile-script";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_CALLBACK_TIMEOUT_MS = 17_000;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => finish(undefined, "Secure session verification timed out"), 15_000);
    const finish = (api?: TurnstileApi, message?: string) => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
      if (api) resolve(api);
      else {
        script.remove();
        reject(new Error(message ?? "Unable to load secure session verification"));
      }
    };
    const handleLoad = () => finish(window.turnstile, "Turnstile did not initialize");
    const handleError = () => finish(undefined, "Unable to load secure session verification");
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      document.head.append(script);
    }
  });
}

interface TurnstileGateProps {
  siteKey: string;
  onError: (message: string) => void;
  onToken: (token: string) => void;
}

export function TurnstileGate({ siteKey, onError, onToken }: TurnstileGateProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!siteKey) {
      onError("Secure relay is not configured; the bundle installer remains available");
      return;
    }
    let cancelled = false;
    let settled = false;
    let widgetId: string | undefined;
    let callbackWatchdog: number | undefined;
    const finish = (callback: () => void) => {
      if (cancelled || settled) return;
      settled = true;
      if (callbackWatchdog !== undefined) window.clearTimeout(callbackWatchdog);
      callback();
    };
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: RELAY_TURNSTILE_ACTION,
          appearance: "interaction-only",
          execution: "execute",
          callback: (token) => finish(() => onToken(token)),
          "error-callback": () => finish(() => onError("Secure session verification failed; try Build with AI again")),
          "expired-callback": () => finish(() => onError("Secure session verification expired; try Build with AI again")),
        });
        turnstile.execute(widgetId);
        if (!settled) {
          callbackWatchdog = window.setTimeout(() => {
            finish(() => onError("Secure session verification timed out; retry verification"));
          }, TURNSTILE_CALLBACK_TIMEOUT_MS);
        }
      })
      .catch((error) => finish(() => onError(error instanceof Error ? error.message : "Unable to start secure verification")));
    return () => {
      cancelled = true;
      if (callbackWatchdog !== undefined) window.clearTimeout(callbackWatchdog);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onError, onToken, siteKey]);

  return <div ref={containerRef} className="relay-turnstile" data-testid="relay-turnstile" />;
}

declare global {
  interface TurnstileApi {
    render: (container: string | HTMLElement, options: {
      sitekey: string;
      action: string;
      appearance: "interaction-only";
      execution: "execute";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    }) => string;
    execute: (widget: string | HTMLElement) => void;
    remove: (widgetId: string) => void;
  }

  interface Window {
    turnstile?: TurnstileApi;
  }
}
