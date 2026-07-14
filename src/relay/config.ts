const configuredRelayUrl = import.meta.env.VITE_RELAY_URL?.trim();
const configuredSiteKey = import.meta.env.VITE_RELAY_TURNSTILE_SITE_KEY?.trim();

export const RELAY_URL = (
  configuredRelayUrl || (import.meta.env.DEV
    ? "http://127.0.0.1:8787"
    : "https://freeform-artifact-relay.morryniu123.workers.dev")
).replace(/\/$/, "");

export const RELAY_TURNSTILE_SITE_KEY = configuredSiteKey || (import.meta.env.DEV
  ? "1x00000000000000000000AA"
  : "0x4AAAAAAD1C8bQ7XDf23fvS");

export const RELAY_TURNSTILE_ACTION = "relay-session";
