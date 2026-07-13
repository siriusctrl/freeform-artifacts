import { DurableObject } from "cloudflare:workers";
import {
  encryptedDeliverySchema,
  RELAY_MAX_CIPHERTEXT_BYTES,
  RELAY_MAX_DELIVERIES_PER_SESSION,
  RELAY_MAX_PENDING_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_TTL_MS,
  RELAY_WEBSOCKET_PROTOCOL,
  relayClientMessageSchema,
  relaySessionCreateSchema,
  type EncryptedRelayDelivery,
} from "../../src/relay/protocol";

const MAX_SESSION_CREATE_BODY_BYTES = 16_384;
const MAX_UPLOAD_BODY_BYTES = Math.ceil(RELAY_MAX_CIPHERTEXT_BYTES * 4 / 3) + 16_384;
const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "relay-session";
const DEVELOPMENT_TURNSTILE_TOKEN = "test-turnstile-pass";
const MAX_WEBSOCKET_MESSAGE_CHARS = 2_048;
const MAX_ACK_MESSAGES_PER_SOCKET = 64;

interface SessionMetadataRow extends Record<string, SqlStorageValue> {
  session_id: string;
  target_view_id: string;
  browser_token_hash: string;
  upload_token_hash: string;
  created_at: number;
  expires_at: number;
}

interface PendingDeliveryRow extends Record<string, SqlStorageValue> {
  delivery_id: string;
  artifact_count: number;
  created_at: string;
  iv: string;
  ciphertext: string;
}

interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

interface RelayResult<T = undefined> {
  ok: boolean;
  status: number;
  code?: string;
  value?: T;
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function uuidBytes(value: string) {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) return null;
  return Uint8Array.from(compact.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function formatUuid(bytes: Uint8Array) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function routingSignature(secret: string, nonce: Uint8Array) {
  if (secret.length < 32) throw new Error("relay_routing_secret_not_configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, nonce));
  const truncated = signature.slice(0, 8);
  truncated[0] = (truncated[0] & 0x3f) | 0x80;
  return truncated;
}

async function createSessionId(secret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  nonce[6] = (nonce[6] & 0x0f) | 0x80;
  const signature = await routingSignature(secret, nonce);
  return formatUuid(Uint8Array.from([...nonce, ...signature]));
}

async function isAuthenticSessionId(secret: string, value: string) {
  const bytes = uuidBytes(value);
  if (!bytes || bytes.length !== 16 || (bytes[6] >> 4) !== 8 || (bytes[8] & 0xc0) !== 0x80) return false;
  const nonce = bytes.slice(0, 8);
  const expected = await routingSignature(secret, nonce);
  return crypto.subtle.timingSafeEqual(bytes.slice(8), expected);
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hashDeliveryEnvelope(delivery: EncryptedRelayDelivery) {
  return hashToken(JSON.stringify([
    delivery.version,
    delivery.deliveryId,
    delivery.artifactCount,
    delivery.createdAt,
    delivery.iv,
    delivery.ciphertext,
  ]));
}

function tokenHashesMatch(actualHash: string, expectedHash: string) {
  const actual = new TextEncoder().encode(actualHash);
  const expected = new TextEncoder().encode(expectedHash);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

function bearerToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function configuredOrigins(env: Env) {
  if (typeof env.ALLOWED_ORIGINS !== "string") return [];
  return env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function allowedOrigins(env: Env) {
  return new Set(configuredOrigins(env));
}

function isAllowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && allowedOrigins(env).has(origin));
}

export function relayConfigurationReady(env: Env) {
  const environment = String(env.ENVIRONMENT);
  const routingReady = typeof env.RELAY_ROUTING_SECRET === "string" && env.RELAY_ROUTING_SECRET.length >= 32;
  const turnstileReady = environment === "development" ||
    (typeof env.TURNSTILE_SECRET === "string" && env.TURNSTILE_SECRET.length > 0);
  const origins = configuredOrigins(env);
  const originsReady = origins.length > 0 && origins.every((origin) => {
    try {
      const url = new URL(origin);
      if (url.origin !== origin) return false;
      return environment === "development" ? isLoopbackOrigin(origin) : url.protocol === "https:";
    } catch {
      return false;
    }
  });
  return routingReady && turnstileReady && originsReady;
}

function isLoopbackOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function developmentTurnstileBypassAllowed(env: Env, origin: string | null, token: string) {
  return String(env.ENVIRONMENT) === "development" &&
    token === DEVELOPMENT_TURNSTILE_TOKEN &&
    isLoopbackOrigin(origin);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status = 200, origin?: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  }
  return Response.json(body, { status, headers });
}

async function readJsonBody(request: Request, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("body_too_large");
  }
  if (!request.body) throw new Error("missing_body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("body_too_large");
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (developmentTurnstileBypassAllowed(env, request.headers.get("Origin"), token)) {
    return { ok: true as const };
  }

  const origin = request.headers.get("Origin");
  if (!origin) return { ok: false as const, code: "missing_origin" };
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  form.set("idempotency_key", crypto.randomUUID());
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, { method: "POST", body: form });
  } catch {
    return { ok: false as const, code: "turnstile_unavailable" };
  }
  if (!response.ok) return { ok: false as const, code: "turnstile_unavailable" };

  const result = await response.json<TurnstileResponse>();
  const expectedHostname = new URL(origin).hostname;
  if (!result.success) return { ok: false as const, code: "turnstile_rejected" };
  if (result.action !== TURNSTILE_ACTION) return { ok: false as const, code: "turnstile_action_mismatch" };
  if (result.hostname !== expectedHostname) return { ok: false as const, code: "turnstile_hostname_mismatch" };
  return { ok: true as const };
}

function parseBrowserWebSocketToken(request: Request) {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((value) => value.trim());
  if (!protocols.includes(RELAY_WEBSOCKET_PROTOCOL)) return "";
  const authProtocol = protocols.find((value) => value.startsWith("browser."));
  return authProtocol?.slice("browser.".length) ?? "";
}

function log(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...data }));
}

export class BuildSession extends DurableObject<Env> {
  private tableExists(name: string) {
    return Boolean(this.ctx.storage.sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    ).toArray()[0]);
  }

  private ensureExistingSchema() {
    if (!this.tableExists("session_metadata")) return false;
    if (!this.tableExists("schema_metadata")) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE schema_metadata (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL
        );
        INSERT INTO schema_metadata (singleton, version) VALUES (1, 1);
      `);
    }
    let version = this.ctx.storage.sql.exec<{ version: number }>(
      "SELECT version FROM schema_metadata WHERE singleton = 1",
    ).one().version;
    if (version === 1) {
      const columns = this.ctx.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(delivery_ids)",
      ).toArray().map((column) => column.name);
      if (!columns.includes("envelope_hash")) {
        this.ctx.storage.sql.exec("ALTER TABLE delivery_ids ADD COLUMN envelope_hash TEXT");
      }
      this.ctx.storage.sql.exec("UPDATE schema_metadata SET version = 2 WHERE singleton = 1");
      version = 2;
    }
    if (version !== 2) throw new Error(`unsupported_session_schema_${version}`);
    return true;
  }

  private migrate() {
    if (this.ensureExistingSchema()) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE schema_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_metadata (singleton, version) VALUES (1, 2);
      CREATE TABLE IF NOT EXISTS session_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL,
        target_view_id TEXT NOT NULL,
        browser_token_hash TEXT NOT NULL,
        upload_token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivery_ids (
        delivery_id TEXT PRIMARY KEY,
        envelope_hash TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_deliveries (
        delivery_id TEXT PRIMARY KEY,
        artifact_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        iv TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        ciphertext_bytes INTEGER NOT NULL,
        FOREIGN KEY (delivery_id) REFERENCES delivery_ids(delivery_id)
      );
    `);
  }

  private metadata() {
    if (!this.ensureExistingSchema()) return null;
    return this.ctx.storage.sql.exec<SessionMetadataRow>(`
      SELECT session_id, target_view_id, browser_token_hash, upload_token_hash, created_at, expires_at
      FROM session_metadata WHERE singleton = 1
    `).toArray()[0] ?? null;
  }

  private pendingDeliveries() {
    if (!this.ensureExistingSchema()) return [];
    return this.ctx.storage.sql.exec<PendingDeliveryRow>(`
      SELECT delivery_id, artifact_count, created_at, iv, ciphertext
      FROM pending_deliveries ORDER BY rowid ASC
    `).toArray().map((row) => ({
      version: RELAY_PROTOCOL_VERSION,
      deliveryId: row.delivery_id,
      artifactCount: row.artifact_count,
      createdAt: row.created_at,
      iv: row.iv,
      ciphertext: row.ciphertext,
    } satisfies EncryptedRelayDelivery));
  }

  private broadcast(message: unknown) {
    const source = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets("browser")) {
      try {
        socket.send(source);
      } catch {
        socket.close(1011, "Relay send failed");
      }
    }
  }

  async initialize(input: {
    sessionId: string;
    targetViewId: string;
    browserTokenHash: string;
    uploadTokenHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<RelayResult<{ expiresAt: number }>> {
    this.migrate();
    if (this.metadata()) return { ok: false, status: 409, code: "session_exists" };
    this.ctx.storage.sql.exec(
      `INSERT INTO session_metadata
        (singleton, session_id, target_view_id, browser_token_hash, upload_token_hash, created_at, expires_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      input.sessionId,
      input.targetViewId,
      input.browserTokenHash,
      input.uploadTokenHash,
      input.createdAt,
      input.expiresAt,
    );
    try {
      await this.ctx.storage.setAlarm(input.expiresAt);
    } catch {
      await this.ctx.storage.deleteAll();
      return { ok: false, status: 503, code: "session_alarm_unavailable" };
    }
    return { ok: true, status: 201, value: { expiresAt: input.expiresAt } };
  }

  authorizeUpload(uploadTokenHash: string): RelayResult {
    const metadata = this.metadata();
    if (!metadata || Date.now() >= metadata.expires_at) {
      if (metadata) this.ctx.waitUntil(this.cleanup("Session expired"));
      return { ok: false, status: 410, code: "session_expired" };
    }
    if (!tokenHashesMatch(uploadTokenHash, metadata.upload_token_hash)) {
      return { ok: false, status: 401, code: "invalid_upload_capability" };
    }
    return { ok: true, status: 204 };
  }

  authorizeBrowser(browserTokenHash: string): RelayResult {
    const metadata = this.metadata();
    if (!metadata || Date.now() >= metadata.expires_at) {
      if (metadata) this.ctx.waitUntil(this.cleanup("Session expired"));
      return { ok: false, status: 410, code: "session_expired" };
    }
    if (!tokenHashesMatch(browserTokenHash, metadata.browser_token_hash)) {
      return { ok: false, status: 401, code: "invalid_browser_capability" };
    }
    return { ok: true, status: 204 };
  }

  async upload(
    uploadTokenHash: string,
    delivery: EncryptedRelayDelivery,
    envelopeHash: string,
  ): Promise<RelayResult<{ duplicate: boolean }>> {
    const authorization = this.authorizeUpload(uploadTokenHash);
    if (!authorization.ok) {
      return { ok: false, status: authorization.status, code: authorization.code };
    }

    const ciphertextBytes = base64UrlToBytes(delivery.ciphertext).byteLength;
    if (ciphertextBytes > RELAY_MAX_CIPHERTEXT_BYTES) {
      return { ok: false, status: 413, code: "ciphertext_too_large" };
    }

    const stored = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<{ delivery_id: string; envelope_hash: string | null }>(
        "SELECT delivery_id, envelope_hash FROM delivery_ids WHERE delivery_id = ?",
        delivery.deliveryId,
      ).toArray()[0];
      if (existing) {
        if (existing.envelope_hash === null) {
          const legacyPending = this.ctx.storage.sql.exec<PendingDeliveryRow>(
            `SELECT delivery_id, artifact_count, created_at, iv, ciphertext
             FROM pending_deliveries WHERE delivery_id = ?`,
            delivery.deliveryId,
          ).toArray()[0];
          const sameLegacyEnvelope = legacyPending &&
            legacyPending.artifact_count === delivery.artifactCount &&
            legacyPending.created_at === delivery.createdAt &&
            legacyPending.iv === delivery.iv &&
            legacyPending.ciphertext === delivery.ciphertext;
          if (!sameLegacyEnvelope) {
            return { ok: false as const, status: 409, code: "delivery_id_conflict" };
          }
          this.ctx.storage.sql.exec(
            "UPDATE delivery_ids SET envelope_hash = ? WHERE delivery_id = ?",
            envelopeHash,
            delivery.deliveryId,
          );
        } else if (existing.envelope_hash !== envelopeHash) {
          return { ok: false as const, status: 409, code: "delivery_id_conflict" };
        }
        return { ok: true as const, duplicate: true };
      }

      const deliveryCount = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM delivery_ids",
      ).one().count;
      if (deliveryCount >= RELAY_MAX_DELIVERIES_PER_SESSION) {
        return { ok: false as const, status: 429, code: "session_delivery_limit" };
      }
      const pendingBytes = this.ctx.storage.sql.exec<{ bytes: number }>(
        "SELECT COALESCE(SUM(ciphertext_bytes), 0) AS bytes FROM pending_deliveries",
      ).one().bytes;
      if (pendingBytes + ciphertextBytes > RELAY_MAX_PENDING_BYTES) {
        return { ok: false as const, status: 429, code: "session_pending_limit" };
      }

      this.ctx.storage.sql.exec(
        "INSERT INTO delivery_ids (delivery_id, envelope_hash, outcome, created_at) VALUES (?, ?, 'pending', ?)",
        delivery.deliveryId,
        envelopeHash,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_deliveries
          (delivery_id, artifact_count, created_at, iv, ciphertext, ciphertext_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        delivery.deliveryId,
        delivery.artifactCount,
        delivery.createdAt,
        delivery.iv,
        delivery.ciphertext,
        ciphertextBytes,
      );
      return { ok: true as const, duplicate: false };
    });

    if (!stored.ok) return { ok: false, status: stored.status, code: stored.code };
    if (!stored.duplicate) {
      this.broadcast({ version: RELAY_PROTOCOL_VERSION, type: "delivery", delivery });
    }
    return { ok: true, status: stored.duplicate ? 200 : 202, value: { duplicate: stored.duplicate } };
  }

  async status(browserTokenHash: string): Promise<RelayResult<{ sessionId: string; targetViewId: string; expiresAt: number; pending: number }>> {
    const metadata = this.metadata();
    if (!metadata || Date.now() >= metadata.expires_at) {
      if (metadata) this.ctx.waitUntil(this.cleanup("Session expired"));
      return { ok: false, status: 410, code: "session_expired" };
    }
    if (!tokenHashesMatch(browserTokenHash, metadata.browser_token_hash)) {
      return { ok: false, status: 401, code: "invalid_browser_capability" };
    }
    const pending = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM pending_deliveries",
    ).one().count;
    return {
      ok: true,
      status: 200,
      value: {
        sessionId: metadata.session_id,
        targetViewId: metadata.target_view_id,
        expiresAt: metadata.expires_at,
        pending,
      },
    };
  }

  async expire(browserTokenHash: string): Promise<RelayResult> {
    const metadata = this.metadata();
    if (!metadata) return { ok: true, status: 204 };
    if (!tokenHashesMatch(browserTokenHash, metadata.browser_token_hash)) {
      return { ok: false, status: 401, code: "invalid_browser_capability" };
    }
    await this.cleanup("Session closed");
    return { ok: true, status: 204 };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "websocket_required" }, 426);
    }
    if (request.headers.get("Sec-WebSocket-Protocol")?.includes("browser.")) {
      return jsonResponse({ error: "raw_browser_capability_forwarded" }, 500);
    }
    const metadata = this.metadata();
    if (!metadata || Date.now() >= metadata.expires_at) {
      return jsonResponse({ error: "session_expired" }, 410);
    }
    const browserTokenHash = request.headers.get("X-Relay-Browser-Token-Hash") ?? "";
    if (!browserTokenHash || !tokenHashesMatch(browserTokenHash, metadata.browser_token_hash)) {
      return jsonResponse({ error: "invalid_browser_capability" }, 401);
    }

    for (const previous of this.ctx.getWebSockets("browser")) {
      previous.close(4001, "Reconnected");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["browser"]);
    server.serializeAttachment({ role: "browser", ackCount: 0 });
    server.send(JSON.stringify({
      version: RELAY_PROTOCOL_VERSION,
      type: "ready",
      sessionId: metadata.session_id,
      targetViewId: metadata.target_view_id,
      expiresAt: new Date(metadata.expires_at).toISOString(),
    }));
    for (const delivery of this.pendingDeliveries()) {
      server.send(JSON.stringify({ version: RELAY_PROTOCOL_VERSION, type: "delivery", delivery }));
    }
    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": RELAY_WEBSOCKET_PROTOCOL },
      webSocket: client,
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (!this.metadata()) {
      socket.close(4000, "Session expired");
      return;
    }
    if (typeof message !== "string") {
      socket.send(JSON.stringify({ version: RELAY_PROTOCOL_VERSION, type: "error", code: "text_messages_only" }));
      return;
    }
    if (message.length > MAX_WEBSOCKET_MESSAGE_CHARS) {
      socket.close(1009, "WebSocket message too large");
      return;
    }
    const attachment = socket.deserializeAttachment() as { role?: string; ackCount?: number } | null;
    const ackCount = attachment?.ackCount ?? 0;
    if (ackCount >= MAX_ACK_MESSAGES_PER_SOCKET) {
      socket.close(1008, "WebSocket acknowledgement limit exceeded");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      socket.send(JSON.stringify({ version: RELAY_PROTOCOL_VERSION, type: "error", code: "invalid_json" }));
      return;
    }
    const parsed = relayClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      socket.send(JSON.stringify({ version: RELAY_PROTOCOL_VERSION, type: "error", code: "invalid_message" }));
      return;
    }
    socket.serializeAttachment({ role: "browser", ackCount: ackCount + 1 });
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM pending_deliveries WHERE delivery_id = ?", parsed.data.deliveryId);
      this.ctx.storage.sql.exec(
        "UPDATE delivery_ids SET outcome = ? WHERE delivery_id = ?",
        parsed.data.outcome,
        parsed.data.deliveryId,
      );
    });
  }

  webSocketClose(_socket: WebSocket, code: number, reason: string) {
    log("info", "websocket_closed", { code, reason });
  }

  webSocketError(socket: WebSocket, error: unknown) {
    log("warn", "websocket_error", { error: error instanceof Error ? error.message : String(error) });
    socket.close(1011, "WebSocket error");
  }

  async alarm() {
    await this.cleanup("Session expired");
  }

  private async cleanup(reason: string) {
    this.broadcast({ version: RELAY_PROTOCOL_VERSION, type: "expired" });
    for (const socket of this.ctx.getWebSockets("browser")) socket.close(4000, reason);
    await this.ctx.storage.deleteAll();
  }
}

async function routeRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  if (request.method === "GET" && url.pathname === "/health") {
    const enabled = env.RELAY_ENABLED === "true";
    const ready = !enabled || relayConfigurationReady(env);
    return jsonResponse({ ok: ready, ready, version: RELAY_PROTOCOL_VERSION, enabled }, ready ? 200 : 503);
  }

  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins(env).has(origin)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (env.RELAY_ENABLED !== "true") {
    return jsonResponse({ error: "relay_disabled" }, 503, isAllowedOrigin(request, env) ? origin : undefined);
  }
  if (!relayConfigurationReady(env)) {
    return jsonResponse({ error: "relay_not_ready" }, 503, isAllowedOrigin(request, env) ? origin : undefined);
  }

  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = request.headers.get("CF-Connecting-IP") ?? "local";
    const rateLimit = await env.SESSION_CREATION_LIMITER.limit({ key: `create:${remoteIp}` });
    if (!rateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, origin);

    let value: unknown;
    try {
      value = await readJsonBody(request, MAX_SESSION_CREATE_BODY_BYTES);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_json";
      return jsonResponse({ error: code }, code === "body_too_large" ? 413 : 400, origin);
    }
    const parsed = relaySessionCreateSchema.safeParse(value);
    if (!parsed.success) return jsonResponse({ error: "invalid_session" }, 400, origin);
    const turnstile = await verifyTurnstile(request, env, parsed.data.turnstileToken);
    if (!turnstile.ok) return jsonResponse({ error: turnstile.code }, 403, origin);

    const sessionId = await createSessionId(env.RELAY_ROUTING_SECRET);
    const createdAt = Date.now();
    const expiresAt = createdAt + RELAY_SESSION_TTL_MS;
    const result = await env.BUILD_SESSIONS.getByName(sessionId).initialize({
      sessionId,
      targetViewId: parsed.data.targetViewId,
      browserTokenHash: parsed.data.browserTokenHash,
      uploadTokenHash: parsed.data.uploadTokenHash,
      createdAt,
      expiresAt,
    });
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, origin);
    log("info", "session_created", { sessionId, expiresAt });
    return jsonResponse({
      version: RELAY_PROTOCOL_VERSION,
      sessionId,
      targetViewId: parsed.data.targetViewId,
      expiresAt: new Date(expiresAt).toISOString(),
    }, 201, origin);
  }

  const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)(?:\/(connect|deliveries))?$/);
  if (!match) return jsonResponse({ error: "not_found" }, 404, isAllowedOrigin(request, env) ? origin : undefined);
  const [, sessionId, action] = match;
  if (!zUuid(sessionId)) return jsonResponse({ error: "invalid_session_id" }, 400);
  if (!await isAuthenticSessionId(env.RELAY_ROUTING_SECRET, sessionId)) {
    return jsonResponse({ error: "session_not_found" }, 404, isAllowedOrigin(request, env) ? origin : undefined);
  }
  const stub = env.BUILD_SESSIONS.getByName(sessionId);

  if (request.method === "GET" && action === "connect") {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = request.headers.get("CF-Connecting-IP") ?? "local";
    const sourceRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `connect-source:${remoteIp}` });
    if (!sourceRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, origin);
    const browserToken = parseBrowserWebSocketToken(request);
    if (!browserToken) return jsonResponse({ error: "invalid_browser_capability" }, 401, origin);
    const browserTokenHash = await hashToken(browserToken);
    const authorization = await stub.authorizeBrowser(browserTokenHash);
    if (!authorization.ok) return jsonResponse({ error: authorization.code }, authorization.status, origin);
    const sessionRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `connect-session:${sessionId}` });
    if (!sessionRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, origin);
    const headers = new Headers(request.headers);
    headers.set("X-Relay-Browser-Token-Hash", browserTokenHash);
    headers.set("Sec-WebSocket-Protocol", RELAY_WEBSOCKET_PROTOCOL);
    return stub.fetch(new Request(request, { headers }));
  }

  if (request.method === "POST" && action === "deliveries") {
    if (origin && !allowedOrigins(env).has(origin)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = request.headers.get("CF-Connecting-IP") ?? "local";
    const sourceRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `upload-source:${remoteIp}` });
    if (!sourceRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429);
    const uploadTokenHash = await hashToken(bearerToken(request));
    const authorization = await stub.authorizeUpload(uploadTokenHash);
    if (!authorization.ok) return jsonResponse({ error: authorization.code }, authorization.status);
    const sessionRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `upload-session:${sessionId}` });
    if (!sessionRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429);
    let value: unknown;
    try {
      value = await readJsonBody(request, MAX_UPLOAD_BODY_BYTES);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_json";
      return jsonResponse({ error: code }, code === "body_too_large" ? 413 : 400);
    }
    const parsed = encryptedDeliverySchema.safeParse(value);
    if (!parsed.success) return jsonResponse({ error: "invalid_delivery" }, 400);
    const result = await stub.upload(uploadTokenHash, parsed.data, await hashDeliveryEnvelope(parsed.data));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status);
    return jsonResponse({
      version: RELAY_PROTOCOL_VERSION,
      deliveryId: parsed.data.deliveryId,
      accepted: true,
      duplicate: result.value?.duplicate ?? false,
    }, result.status);
  }

  if (request.method === "GET" && !action) {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const result = await stub.status(await hashToken(bearerToken(request)));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, origin);
    return jsonResponse({ version: RELAY_PROTOCOL_VERSION, ...result.value }, 200, origin);
  }

  if (request.method === "DELETE" && !action) {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const result = await stub.expire(await hashToken(bearerToken(request)));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin!) });
  }

  return jsonResponse({ error: "not_found" }, 404, isAllowedOrigin(request, env) ? origin : undefined);
}

function zUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      log("error", "unhandled_request_error", {
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse({ error: "internal_error" }, 500, isAllowedOrigin(request, env) ? request.headers.get("Origin") : undefined);
    }
  },
} satisfies ExportedHandler<Env>;
