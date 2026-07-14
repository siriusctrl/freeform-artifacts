import { DurableObject } from "cloudflare:workers";
import {
  RELAY_MAX_CIPHERTEXT_BYTES,
  RELAY_MAX_DELIVERIES_PER_SESSION,
  RELAY_MAX_PENDING_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_WEBSOCKET_PROTOCOL,
  relayClientMessageSchema,
  type EncryptedRelayDelivery,
} from "../../src/relay/protocol";
import { jsonResponse, log } from "./http";
import { base64UrlToBytes, tokenHashesMatch } from "./security";

const MAX_WEBSOCKET_MESSAGE_BYTES = 2_048;
const MAX_WEBSOCKET_MESSAGES_PER_SOCKET = 64;

interface StoredSessionMetadataRow extends Record<string, SqlStorageValue> {
  session_id: string;
  target_view_id: string;
  target_view_incarnation_id: string | null;
  browser_token_hash: string;
  upload_token_hash: string;
  created_at: number;
  expires_at: number;
}

type SessionMetadataRow = StoredSessionMetadataRow & {
  target_view_incarnation_id: string;
};

interface PendingDeliveryRow extends Record<string, SqlStorageValue> {
  delivery_id: string;
  artifact_count: number;
  created_at: string;
  iv: string;
  ciphertext: string;
}

interface BrowserSocketAttachment {
  role?: string;
  messageCount?: number;
}

function socketAttachment(socket: WebSocket): BrowserSocketAttachment {
  const value: unknown = socket.deserializeAttachment();
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const role = "role" in value && typeof value.role === "string" ? value.role : undefined;
  const messageCount = "messageCount" in value && typeof value.messageCount === "number" &&
      Number.isSafeInteger(value.messageCount) && value.messageCount >= 0
    ? value.messageCount
    : "ackCount" in value && typeof value.ackCount === "number" &&
        Number.isSafeInteger(value.ackCount) && value.ackCount >= 0
      ? value.ackCount
      : undefined;
  return { role, messageCount };
}

function websocketMessageByteLength(message: string | ArrayBuffer) {
  if (typeof message !== "string") return message.byteLength;
  if (message.length > MAX_WEBSOCKET_MESSAGE_BYTES) return MAX_WEBSOCKET_MESSAGE_BYTES + 1;
  return new TextEncoder().encode(message).byteLength;
}

export interface SessionInitializeInput {
  sessionId: string;
  targetViewId: string;
  targetViewIncarnationId: string;
  browserTokenHash: string;
  uploadTokenHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionReadyPayload {
  version: typeof RELAY_PROTOCOL_VERSION;
  type: "ready";
  sessionId: string;
  targetViewId: string;
  targetViewIncarnationId: string;
  expiresAt: string;
}

export interface SessionStatus {
  sessionId: string;
  targetViewId: string;
  targetViewIncarnationId: string;
  expiresAt: number;
  pending: number;
}

export interface RelayResult<T = undefined> {
  ok: boolean;
  status: number;
  code?: string;
  value?: T;
}

function readyPayload(metadata: SessionMetadataRow): SessionReadyPayload {
  return {
    version: RELAY_PROTOCOL_VERSION,
    type: "ready",
    sessionId: metadata.session_id,
    targetViewId: metadata.target_view_id,
    targetViewIncarnationId: metadata.target_view_incarnation_id,
    expiresAt: new Date(metadata.expires_at).toISOString(),
  };
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
    if (version === 2) {
      const columns = this.ctx.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(session_metadata)",
      ).toArray().map((column) => column.name);
      if (!columns.includes("target_view_incarnation_id")) {
        this.ctx.storage.sql.exec("ALTER TABLE session_metadata ADD COLUMN target_view_incarnation_id TEXT");
      }
      this.ctx.storage.sql.exec("UPDATE schema_metadata SET version = 3 WHERE singleton = 1");
      version = 3;
    }
    if (version !== 3) throw new Error(`unsupported_session_schema_${version}`);
    return true;
  }

  private migrate() {
    if (this.ensureExistingSchema()) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE schema_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_metadata (singleton, version) VALUES (1, 3);
      CREATE TABLE IF NOT EXISTS session_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL,
        target_view_id TEXT NOT NULL,
        target_view_incarnation_id TEXT NOT NULL,
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
    const metadata = this.ctx.storage.sql.exec<StoredSessionMetadataRow>(`
      SELECT session_id, target_view_id, target_view_incarnation_id,
             browser_token_hash, upload_token_hash, created_at, expires_at
      FROM session_metadata WHERE singleton = 1
    `).toArray()[0] ?? null;
    if (!metadata || typeof metadata.target_view_incarnation_id !== "string" ||
      metadata.target_view_incarnation_id.length === 0) return null;
    return {
      ...metadata,
      target_view_incarnation_id: metadata.target_view_incarnation_id,
    };
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

  async initialize(input: SessionInitializeInput): Promise<RelayResult<{ expiresAt: number }>> {
    this.migrate();
    if (this.metadata()) return { ok: false, status: 409, code: "session_exists" };
    this.ctx.storage.sql.exec(
      `INSERT INTO session_metadata
        (singleton, session_id, target_view_id, target_view_incarnation_id,
         browser_token_hash, upload_token_hash, created_at, expires_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      input.sessionId,
      input.targetViewId,
      input.targetViewIncarnationId,
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

  async status(browserTokenHash: string): Promise<RelayResult<SessionStatus>> {
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
        targetViewIncarnationId: metadata.target_view_incarnation_id,
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
    server.serializeAttachment({ role: "browser", messageCount: 0 } satisfies BrowserSocketAttachment);
    server.send(JSON.stringify(readyPayload(metadata)));
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
    const metadata = this.metadata();
    if (!metadata || Date.now() >= metadata.expires_at) {
      if (metadata) this.ctx.waitUntil(this.cleanup("Session expired"));
      socket.close(4000, "Session expired");
      return;
    }

    const attachment = socketAttachment(socket);
    const messageCount = (attachment.messageCount ?? 0) + 1;
    socket.serializeAttachment({
      role: attachment.role ?? "browser",
      messageCount,
    } satisfies BrowserSocketAttachment);
    if (messageCount > MAX_WEBSOCKET_MESSAGES_PER_SOCKET) {
      socket.close(1008, "WebSocket message limit exceeded");
      return;
    }
    if (websocketMessageByteLength(message) > MAX_WEBSOCKET_MESSAGE_BYTES) {
      socket.close(1009, "WebSocket message too large");
      return;
    }
    if (typeof message !== "string") {
      socket.close(1003, "Text messages only");
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      socket.close(1007, "Invalid JSON message");
      return;
    }
    const parsed = relayClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      socket.close(1008, "Invalid relay message");
      return;
    }
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
