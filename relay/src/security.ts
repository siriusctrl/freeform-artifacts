import type { EncryptedRelayDelivery } from "../../src/relay/protocol";

export function base64UrlToBytes(value: string) {
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

export async function createSessionId(secret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  nonce[6] = (nonce[6] & 0x0f) | 0x80;
  const signature = await routingSignature(secret, nonce);
  return formatUuid(Uint8Array.from([...nonce, ...signature]));
}

export async function isAuthenticSessionId(secret: string, value: string) {
  const bytes = uuidBytes(value);
  if (!bytes || bytes.length !== 16 || (bytes[6] >> 4) !== 8 || (bytes[8] & 0xc0) !== 0x80) return false;
  const nonce = bytes.slice(0, 8);
  const expected = await routingSignature(secret, nonce);
  return crypto.subtle.timingSafeEqual(bytes.slice(8), expected);
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function hashDeliveryEnvelope(delivery: EncryptedRelayDelivery) {
  return hashToken(JSON.stringify([
    delivery.version,
    delivery.deliveryId,
    delivery.artifactCount,
    delivery.createdAt,
    delivery.iv,
    delivery.ciphertext,
  ]));
}

export function tokenHashesMatch(actualHash: string, expectedHash: string) {
  const actual = new TextEncoder().encode(actualHash);
  const expected = new TextEncoder().encode(expectedHash);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

export function bearerToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function configuredOrigins(env: Env) {
  if (typeof env.ALLOWED_ORIGINS !== "string") return [];
  return env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function allowedOrigins(env: Env) {
  return new Set(configuredOrigins(env));
}

export function allowedOriginForRequest(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  return origin && allowedOrigins(env).has(origin) ? origin : null;
}

export function isAllowedOrigin(request: Request, env: Env) {
  return allowedOriginForRequest(request, env) !== null;
}

export function isLoopbackOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function normalizeRateLimitSource(source: string | null) {
  const candidate = source?.trim().toLowerCase();
  if (!candidate) return "local";
  const parseIpv4 = (value: string) => {
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
    const octets = parts.map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
  };
  if (!candidate.includes(":")) {
    const ipv4 = parseIpv4(candidate);
    return ipv4 ? ipv4.join(".") : candidate;
  }

  const unwrapped = candidate.startsWith("[") && candidate.endsWith("]")
    ? candidate.slice(1, -1)
    : candidate;
  const withoutZone = unwrapped.split("%", 1)[0];
  const dottedTail = withoutZone.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/)?.[1];
  const ipv4Tail = dottedTail ? parseIpv4(dottedTail) : null;
  if (dottedTail && !ipv4Tail) return candidate;
  const hexadecimal = ipv4Tail
    ? `${withoutZone.slice(0, -dottedTail!.length)}${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`
    : withoutZone;

  const halves = hexadecimal.split("::");
  if (halves.length > 2) return candidate;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 ? left.length !== 8 : left.length + right.length >= 8) return candidate;
  const groups = halves.length === 2
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return candidate;
  const numeric = groups.map((group) => Number.parseInt(group, 16));
  const ipv4Mapped = numeric.slice(0, 5).every((group) => group === 0) && numeric[5] === 0xffff;
  if (ipv4Mapped) {
    return [numeric[6] >> 8, numeric[6] & 0xff, numeric[7] >> 8, numeric[7] & 0xff].join(".");
  }
  return `${numeric.slice(0, 4).map((group) => group.toString(16).padStart(4, "0")).join(":")}::/64`;
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

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
