import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  developmentTurnstileBypassAllowed,
  normalizeRateLimitSource,
  relayConfigurationReady,
} from "../src/index";
import { verifyTurnstile } from "../src/http";

const APP_ORIGIN = "http://127.0.0.1:4177";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relay edge security", () => {
  it("fails closed for misspelled environments and limits the development bypass to loopback", () => {
    const base = {
      RELAY_ROUTING_SECRET: "r".repeat(32),
      TURNSTILE_SECRET: "",
    };
    const preview = { ...base, ENVIRONMENT: "preview", TURNSTILE_SECRET: "configured" } as unknown as Env;
    const development = { ...base, ENVIRONMENT: "development", ALLOWED_ORIGINS: APP_ORIGIN } as unknown as Env;
    expect(relayConfigurationReady(preview)).toBe(false);
    expect(relayConfigurationReady(development)).toBe(true);
    expect(relayConfigurationReady({
      ...preview,
      ALLOWED_ORIGINS: "http://public.example",
    } as unknown as Env)).toBe(false);
    expect(developmentTurnstileBypassAllowed(
      preview,
      APP_ORIGIN,
      "test-turnstile-pass",
      "http://127.0.0.1/v1/sessions",
    )).toBe(false);
    expect(developmentTurnstileBypassAllowed(
      development,
      APP_ORIGIN,
      "test-turnstile-pass",
      "http://127.0.0.1/v1/sessions",
    )).toBe(true);
    expect(developmentTurnstileBypassAllowed(
      development,
      "https://public.example",
      "test-turnstile-pass",
      "http://127.0.0.1/v1/sessions",
    )).toBe(false);
    expect(developmentTurnstileBypassAllowed(
      development,
      APP_ORIGIN,
      "test-turnstile-pass",
      "https://public-preview.example/v1/sessions",
    )).toBe(false);
  });

  it("groups IPv6 rate-limit sources by /64 without coalescing IPv4 clients", () => {
    expect(normalizeRateLimitSource("2001:db8:abcd:12::1"))
      .toBe(normalizeRateLimitSource("2001:0db8:abcd:0012:ffff::9"));
    expect(normalizeRateLimitSource("2001:db8:abcd:12::1"))
      .not.toBe(normalizeRateLimitSource("2001:db8:abcd:13::1"));
    expect(normalizeRateLimitSource("192.0.2.8")).toBe("192.0.2.8");
    expect(normalizeRateLimitSource("::ffff:192.0.2.8")).toBe("192.0.2.8");
    expect(normalizeRateLimitSource("0:0:0:0:0:ffff:c000:0208")).toBe("192.0.2.8");
    expect(normalizeRateLimitSource("64:ff9b::192.0.2.8"))
      .toBe(normalizeRateLimitSource("64:ff9b::c000:208"));
    expect(normalizeRateLimitSource("64:ff9b::192.0.2.8")).not.toBe("192.0.2.8");
  });

  it("returns CORS headers for every allowlisted malformed or unknown session path", async () => {
    const cases = [
      {
        path: "/v1/sessions/00000000-0000-0000-8000-000000000000",
        status: 400,
        error: "invalid_session_id",
      },
      {
        path: `/v1/sessions/${crypto.randomUUID()}`,
        status: 404,
        error: "session_not_found",
      },
      {
        path: "/v1/sessions/not-a-session/unknown",
        status: 404,
        error: "not_found",
      },
    ];

    for (const testCase of cases) {
      const response = await SELF.fetch(`https://relay.test${testCase.path}`, {
        headers: { Origin: APP_ORIGIN },
      });
      expect(response.status).toBe(testCase.status);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
      expect(response.headers.get("Vary")).toBe("Origin");
      await expect(response.json()).resolves.toEqual({ error: testCase.error });
    }
  });

  it("fails Turnstile closed when a successful siteverify response is non-JSON or malformed", async () => {
    const request = new Request("https://relay.test/v1/sessions", {
      method: "POST",
      headers: { Origin: APP_ORIGIN },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const turnstileEnv = { ...env, TURNSTILE_SECRET: "test-secret" } as unknown as Env;

    fetchSpy.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(verifyTurnstile(request, turnstileEnv, "not-the-development-token")).resolves.toEqual({
      ok: false,
      code: "turnstile_unavailable",
    });

    fetchSpy.mockResolvedValueOnce(Response.json({ success: "true" }));
    await expect(verifyTurnstile(request, turnstileEnv, "not-the-development-token")).resolves.toEqual({
      ok: false,
      code: "turnstile_unavailable",
    });
  });
});
