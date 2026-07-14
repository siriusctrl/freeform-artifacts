import {
  RELAY_MAX_CIPHERTEXT_BYTES,
  RELAY_WEBSOCKET_PROTOCOL,
} from "../../src/relay/protocol";
import { isLoopbackOrigin } from "./security";

export const MAX_SESSION_CREATE_BODY_BYTES = 16_384;
export const MAX_UPLOAD_BODY_BYTES = Math.ceil(RELAY_MAX_CIPHERTEXT_BYTES * 4 / 3) + 16_384;

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "relay-session";
const DEVELOPMENT_TURNSTILE_TOKEN = "test-turnstile-pass";

interface TurnstileResponse {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function developmentTurnstileBypassAllowed(
  env: Env,
  origin: string | null,
  token: string,
  requestUrl: string,
) {
  return String(env.ENVIRONMENT) === "development" &&
    token === DEVELOPMENT_TURNSTILE_TOKEN &&
    isLoopbackOrigin(origin) &&
    isLoopbackOrigin(new URL(requestUrl).origin);
}

export function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export function jsonResponse(body: unknown, status = 200, origin?: string | null) {
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

export function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readJsonBody(request: Request, maximumBytes: number): Promise<unknown> {
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

function parseTurnstileResponse(value: unknown): TurnstileResponse | null {
  if (!isRecord(value)) return null;
  const record = value;
  if (typeof record.success !== "boolean") return null;
  if (record.action !== undefined && typeof record.action !== "string") return null;
  if (record.hostname !== undefined && typeof record.hostname !== "string") return null;
  let errorCodes: string[] | undefined;
  const rawErrorCodes = record["error-codes"];
  if (rawErrorCodes !== undefined) {
    if (!Array.isArray(rawErrorCodes)) return null;
    errorCodes = rawErrorCodes.filter((code): code is string => typeof code === "string");
    if (errorCodes.length !== rawErrorCodes.length) return null;
  }
  const action = typeof record.action === "string" ? record.action : undefined;
  const hostname = typeof record.hostname === "string" ? record.hostname : undefined;
  if (record.success && (action === undefined || hostname === undefined)) {
    return null;
  }
  return {
    success: record.success,
    action,
    hostname,
    "error-codes": errorCodes,
  };
}

export async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (developmentTurnstileBypassAllowed(env, request.headers.get("Origin"), token, request.url)) {
    return { ok: true as const };
  }

  const origin = request.headers.get("Origin");
  if (!origin) return { ok: false as const, code: "missing_origin" };
  if (typeof env.TURNSTILE_SECRET !== "string" || env.TURNSTILE_SECRET.length === 0) {
    return { ok: false as const, code: "turnstile_unavailable" };
  }
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

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { ok: false as const, code: "turnstile_unavailable" };
  }
  const result = parseTurnstileResponse(value);
  if (!result) return { ok: false as const, code: "turnstile_unavailable" };

  const expectedHostname = new URL(origin).hostname;
  if (!result.success) return { ok: false as const, code: "turnstile_rejected" };
  if (result.action !== TURNSTILE_ACTION) return { ok: false as const, code: "turnstile_action_mismatch" };
  if (result.hostname !== expectedHostname) return { ok: false as const, code: "turnstile_hostname_mismatch" };
  return { ok: true as const };
}

export function parseBrowserWebSocketToken(request: Request) {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((value) => value.trim());
  if (!protocols.includes(RELAY_WEBSOCKET_PROTOCOL)) return "";
  const authProtocol = protocols.find((value) => value.startsWith("browser."));
  return authProtocol?.slice("browser.".length) ?? "";
}

export function log(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...data });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}
