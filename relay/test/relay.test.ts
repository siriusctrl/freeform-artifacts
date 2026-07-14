import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  RELAY_MAX_CIPHERTEXT_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_WEBSOCKET_PROTOCOL,
  relayServerMessageSchema,
  type EncryptedRelayDelivery,
} from "../../src/relay/protocol";
import {
  developmentTurnstileBypassAllowed,
  normalizeRateLimitSource,
  relayConfigurationReady,
} from "../src/index";

const APP_ORIGIN = "http://127.0.0.1:4177";
const browserToken = "browser-capability-for-relay-tests";
const uploadToken = "upload-capability-for-relay-tests";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function createSession(targetViewId = "market-overview") {
  const sourceSegment = crypto.randomUUID().replaceAll("-", "").slice(0, 4);
  const response = await SELF.fetch("http://127.0.0.1/v1/sessions", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": `2001:db8:${sourceSegment}::1`,
      "Content-Type": "application/json",
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({
      version: RELAY_PROTOCOL_VERSION,
      targetViewId,
      browserTokenHash: await tokenHash(browserToken),
      uploadTokenHash: await tokenHash(uploadToken),
      turnstileToken: "test-turnstile-pass",
    }),
  });
  const body = await response.json<{
    version: number;
    sessionId: string;
    targetViewId: string;
    expiresAt: string;
    error?: string;
  }>();
  return { response, body };
}

function delivery(deliveryId = crypto.randomUUID()): EncryptedRelayDelivery {
  return {
    version: RELAY_PROTOCOL_VERSION,
    deliveryId,
    artifactCount: 2,
    createdAt: new Date().toISOString(),
    iv: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12))),
    ciphertext: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(64))),
  };
}

async function upload(
  sessionId: string,
  value: EncryptedRelayDelivery,
  token = uploadToken,
  sourceIp = `test-${sessionId}`,
) {
  return SELF.fetch(`https://relay.test/v1/sessions/${sessionId}/deliveries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "CF-Connecting-IP": sourceIp,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

async function sessionStatus(sessionId: string) {
  return SELF.fetch(`https://relay.test/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${browserToken}`, Origin: APP_ORIGIN },
  });
}

function nextMessage(socket: WebSocket) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for relay WebSocket message")), 2_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
  });
}

function nextClose(socket: WebSocket) {
  return new Promise<CloseEvent>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for relay WebSocket close")), 2_000);
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      resolve(event);
    }, { once: true });
  });
}

async function connect(sessionId: string) {
  const response = await SELF.fetch(`https://relay.test/v1/sessions/${sessionId}/connect`, {
    headers: {
      Origin: APP_ORIGIN,
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `${RELAY_WEBSOCKET_PROTOCOL}, browser.${browserToken}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  socket!.accept();
  return socket!;
}

describe("artifact delivery relay", () => {
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

  it("creates a view-bound session with strict CORS and a thirty-minute expiry", async () => {
    const rejected = await SELF.fetch("https://relay.test/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: "{}",
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const { response, body } = await createSession("canvas-security-review");
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
    expect(body).toMatchObject({ version: 1, targetViewId: "canvas-security-review" });
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000);
  });

  it("rejects forged session locators before routing to a Durable Object", async () => {
    const forged = crypto.randomUUID();
    const response = await upload(forged, delivery());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "session_not_found" });
  });

  it("keeps browser and upload capabilities separate and makes delivery ids idempotent", async () => {
    const { body } = await createSession();
    const value = delivery();

    for (let index = 0; index < 30; index += 1) {
      const unauthorized = await upload(body.sessionId, value, browserToken, "shared-invalid-source");
      expect(unauthorized.status).toBe(401);
      await expect(unauthorized.json()).resolves.toEqual({ error: "invalid_upload_capability" });
    }
    const sourceLimited = await upload(body.sessionId, value, browserToken, "shared-invalid-source");
    expect(sourceLimited.status).toBe(429);
    await expect(sourceLimited.json()).resolves.toEqual({ error: "rate_limited" });

    const accepted = await upload(body.sessionId, value, uploadToken, "valid-source");
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ accepted: true, duplicate: false });

    const duplicate = await upload(body.sessionId, value);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ accepted: true, duplicate: true });

    const conflict = await upload(body.sessionId, { ...value, ciphertext: delivery().ciphertext });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "delivery_id_conflict" });

    const stub = env.BUILD_SESSIONS.getByName(body.sessionId);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(`
        ALTER TABLE delivery_ids DROP COLUMN envelope_hash;
        UPDATE schema_metadata SET version = 1 WHERE singleton = 1;
      `);
    });
    const migratedDuplicate = await upload(body.sessionId, value);
    expect(migratedDuplicate.status).toBe(200);
    await expect(migratedDuplicate.json()).resolves.toMatchObject({ duplicate: true });
    const migratedSchema = await runInDurableObject(stub, (_instance, state) => ({
      version: state.storage.sql.exec<{ version: number }>(
        "SELECT version FROM schema_metadata WHERE singleton = 1",
      ).one().version,
      envelopeHash: state.storage.sql.exec<{ envelope_hash: string | null }>(
        "SELECT envelope_hash FROM delivery_ids WHERE delivery_id = ?",
        value.deliveryId,
      ).one().envelope_hash,
    }));
    expect(migratedSchema.version).toBe(2);
    expect(migratedSchema.envelopeHash).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const status = await sessionStatus(body.sessionId);
    await expect(status.json()).resolves.toMatchObject({ pending: 1, targetViewId: "market-overview" });
  });

  it("does not let the upload capability inspect, close, or connect as the browser", async () => {
    const { body } = await createSession();
    const status = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}`, {
      headers: { Authorization: `Bearer ${uploadToken}`, Origin: APP_ORIGIN },
    });
    expect(status.status).toBe(401);

    const close = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${uploadToken}`, Origin: APP_ORIGIN },
    });
    expect(close.status).toBe(401);

    for (let index = 0; index < 31; index += 1) {
      const websocket = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}/connect`, {
        headers: {
          "CF-Connecting-IP": `invalid-browser-source-${index}`,
          Origin: APP_ORIGIN,
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `${RELAY_WEBSOCKET_PROTOCOL}, browser.${uploadToken}`,
        },
      });
      expect(websocket.status).toBe(401);
    }
    const validSocket = await connect(body.sessionId);
    expect(relayServerMessageSchema.parse(await nextMessage(validSocket))).toMatchObject({ type: "ready" });
    validSocket.close(1000, "Capability isolation complete");
    expect((await sessionStatus(body.sessionId)).status).toBe(200);
  });

  it("replays pending ciphertext after reconnect and deletes it only after a terminal ack", async () => {
    const { body } = await createSession();
    const socket = await connect(body.sessionId);
    const ready = relayServerMessageSchema.parse(await nextMessage(socket));
    expect(ready).toMatchObject({ type: "ready", targetViewId: "market-overview" });

    const value = delivery();
    const pushedMessage = nextMessage(socket);
    expect((await upload(body.sessionId, value)).status).toBe(202);
    expect(relayServerMessageSchema.parse(await pushedMessage)).toMatchObject({
      type: "delivery",
      delivery: { deliveryId: value.deliveryId, ciphertext: value.ciphertext },
    });
    socket.close(1000, "Reconnect test");

    const reconnected = await connect(body.sessionId);
    expect(relayServerMessageSchema.parse(await nextMessage(reconnected))).toMatchObject({ type: "ready" });
    expect(relayServerMessageSchema.parse(await nextMessage(reconnected))).toMatchObject({
      type: "delivery",
      delivery: { deliveryId: value.deliveryId },
    });
    reconnected.send(JSON.stringify({
      version: RELAY_PROTOCOL_VERSION,
      type: "ack",
      deliveryId: value.deliveryId,
      outcome: "installed",
    }));

    await expect.poll(async () => {
      const response = await sessionStatus(body.sessionId);
      const state = await response.json<{ pending: number }>();
      return state.pending;
    }).toBe(0);
    reconnected.close(1000, "Done");
  });

  it("refuses WebSocket acknowledgements after synchronous session expiry", async () => {
    const { body } = await createSession();
    const socket = await connect(body.sessionId);
    expect(relayServerMessageSchema.parse(await nextMessage(socket))).toMatchObject({ type: "ready" });
    const value = delivery();
    const pushedMessage = nextMessage(socket);
    expect((await upload(body.sessionId, value)).status).toBe(202);
    expect(relayServerMessageSchema.parse(await pushedMessage)).toMatchObject({
      type: "delivery",
      delivery: { deliveryId: value.deliveryId },
    });

    const stub = env.BUILD_SESSIONS.getByName(body.sessionId);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE session_metadata SET expires_at = ? WHERE singleton = 1",
        Date.now() - 1,
      );
    });
    const closed = nextClose(socket);
    socket.send(JSON.stringify({
      version: RELAY_PROTOCOL_VERSION,
      type: "ack",
      deliveryId: value.deliveryId,
      outcome: "installed",
    }));
    expect((await closed).code).toBe(4000);
    expect((await sessionStatus(body.sessionId)).status).toBe(410);
  });

  it("cleans session state on its alarm and refuses later replay", async () => {
    const { body } = await createSession();
    const value = delivery();
    expect((await upload(body.sessionId, value)).status).toBe(202);

    const stub = env.BUILD_SESSIONS.getByName(body.sessionId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const expired = await sessionStatus(body.sessionId);
    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toEqual({ error: "session_expired" });
    expect((await upload(body.sessionId, value)).status).toBe(410);
  });

  it("cannot orphan ciphertext when cleanup races an upload", async () => {
    const { body } = await createSession("cleanup-race");
    const closeRequest = SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${browserToken}`, Origin: APP_ORIGIN },
    });
    const uploadRequest = upload(body.sessionId, delivery());
    const [close, attemptedUpload] = await Promise.all([closeRequest, uploadRequest]);
    expect(close.status).toBe(204);
    expect([202, 410]).toContain(attemptedUpload.status);
    expect((await sessionStatus(body.sessionId)).status).toBe(410);
    expect((await upload(body.sessionId, delivery())).status).toBe(410);
    const stub = env.BUILD_SESSIONS.getByName(body.sessionId);
    const tables = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_metadata', 'session_metadata', 'delivery_ids', 'pending_deliveries')",
      ).toArray().map((row) => row.name));
    expect(tables).toEqual([]);
  });

  it("rejects malformed, oversized, and cross-origin delivery attempts", async () => {
    const { body } = await createSession();
    const malformed = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}/deliveries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...delivery(), artifactCount: 13 }),
    });
    expect(malformed.status).toBe(400);

    const invalidBase64Length = await upload(body.sessionId, {
      ...delivery(),
      ciphertext: "A".repeat(17),
    });
    expect(invalidBase64Length.status).toBe(400);

    const crossOrigin = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}/deliveries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      body: JSON.stringify(delivery()),
    });
    expect(crossOrigin.status).toBe(403);

    const allowedOriginUpload = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}/deliveries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        "CF-Connecting-IP": "cors-browser-upload",
        "Content-Type": "application/json",
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify(delivery()),
    });
    expect(allowedOriginUpload.status).toBe(202);
    expect(allowedOriginUpload.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);

    const allowedOriginError = await SELF.fetch(`https://relay.test/v1/sessions/${body.sessionId}/deliveries`, {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-upload-capability",
        "CF-Connecting-IP": "cors-browser-error",
        "Content-Type": "application/json",
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify(delivery()),
    });
    expect(allowedOriginError.status).toBe(401);
    expect(allowedOriginError.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);

    const boundary = delivery();
    boundary.ciphertext = bytesToBase64Url(new Uint8Array(RELAY_MAX_CIPHERTEXT_BYTES));
    expect((await upload(body.sessionId, boundary)).status).toBe(202);

    const tooLarge = delivery();
    tooLarge.ciphertext = bytesToBase64Url(new Uint8Array(RELAY_MAX_CIPHERTEXT_BYTES + 1));
    const oversized = await upload(body.sessionId, tooLarge);
    expect(oversized.status).toBe(413);
  });

  it("enforces the per-session delivery ceiling while preserving idempotent retries", async () => {
    const { body } = await createSession();
    const first = delivery();
    expect((await upload(body.sessionId, first)).status).toBe(202);
    for (let index = 1; index < 24; index += 1) {
      expect((await upload(body.sessionId, delivery())).status).toBe(202);
    }
    const limited = await upload(body.sessionId, delivery());
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({ error: "session_delivery_limit" });
    const duplicate = await upload(body.sessionId, first);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true });
  });
});
