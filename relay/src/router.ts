import {
  encryptedDeliverySchema,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_TTL_MS,
  RELAY_WEBSOCKET_PROTOCOL,
  relaySessionCreateSchema,
} from "../../src/relay/protocol";
import {
  corsHeaders,
  jsonResponse,
  log,
  MAX_SESSION_CREATE_BODY_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  parseBrowserWebSocketToken,
  readJsonBody,
  verifyTurnstile,
  withCors,
} from "./http";
import {
  allowedOriginForRequest,
  allowedOrigins,
  bearerToken,
  createSessionId,
  hashDeliveryEnvelope,
  hashToken,
  isAuthenticSessionId,
  isUuid,
  normalizeRateLimitSource,
  relayConfigurationReady,
} from "./security";

export async function routeRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const responseOrigin = allowedOriginForRequest(request, env);

  if (request.method === "GET" && url.pathname === "/health") {
    const enabled = env.RELAY_ENABLED === "true";
    const ready = !enabled || relayConfigurationReady(env);
    return jsonResponse({ ok: ready, ready, version: RELAY_PROTOCOL_VERSION, enabled }, ready ? 200 : 503);
  }

  if (request.method === "OPTIONS") {
    if (!responseOrigin) return jsonResponse({ error: "origin_not_allowed" }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) });
  }

  if (env.RELAY_ENABLED !== "true") {
    return jsonResponse({ error: "relay_disabled" }, 503, responseOrigin);
  }
  if (!relayConfigurationReady(env)) {
    return jsonResponse({ error: "relay_not_ready" }, 503, responseOrigin);
  }

  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    if (!responseOrigin) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = normalizeRateLimitSource(request.headers.get("CF-Connecting-IP"));
    const rateLimit = await env.SESSION_CREATION_LIMITER.limit({ key: `create:${remoteIp}` });
    if (!rateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, responseOrigin);

    let value: unknown;
    try {
      value = await readJsonBody(request, MAX_SESSION_CREATE_BODY_BYTES);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_json";
      return jsonResponse({ error: code }, code === "body_too_large" ? 413 : 400, responseOrigin);
    }
    const parsed = relaySessionCreateSchema.safeParse(value);
    if (!parsed.success) return jsonResponse({ error: "invalid_session" }, 400, responseOrigin);
    const turnstile = await verifyTurnstile(request, env, parsed.data.turnstileToken);
    if (!turnstile.ok) return jsonResponse({ error: turnstile.code }, 403, responseOrigin);

    const sessionId = await createSessionId(env.RELAY_ROUTING_SECRET);
    const createdAt = Date.now();
    const expiresAt = createdAt + RELAY_SESSION_TTL_MS;
    const result = await env.BUILD_SESSIONS.getByName(sessionId).initialize({
      sessionId,
      targetViewId: parsed.data.targetViewId,
      targetViewIncarnationId: parsed.data.targetViewIncarnationId,
      browserTokenHash: parsed.data.browserTokenHash,
      uploadTokenHash: parsed.data.uploadTokenHash,
      createdAt,
      expiresAt,
    });
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, responseOrigin);
    log("info", "session_created", { sessionId, expiresAt });
    return jsonResponse({
      version: RELAY_PROTOCOL_VERSION,
      sessionId,
      targetViewId: parsed.data.targetViewId,
      targetViewIncarnationId: parsed.data.targetViewIncarnationId,
      expiresAt: new Date(expiresAt).toISOString(),
    }, 201, responseOrigin);
  }

  const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)(?:\/(connect|deliveries))?$/);
  if (!match) return jsonResponse({ error: "not_found" }, 404, responseOrigin);
  const [, sessionId, action] = match;
  if (!isUuid(sessionId)) return jsonResponse({ error: "invalid_session_id" }, 400, responseOrigin);
  if (!await isAuthenticSessionId(env.RELAY_ROUTING_SECRET, sessionId)) {
    return jsonResponse({ error: "session_not_found" }, 404, responseOrigin);
  }
  const stub = env.BUILD_SESSIONS.getByName(sessionId);

  if (request.method === "GET" && action === "connect") {
    if (!responseOrigin) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = normalizeRateLimitSource(request.headers.get("CF-Connecting-IP"));
    const sourceRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `connect-source:${remoteIp}` });
    if (!sourceRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, responseOrigin);
    const browserToken = parseBrowserWebSocketToken(request);
    if (!browserToken) return jsonResponse({ error: "invalid_browser_capability" }, 401, responseOrigin);
    const browserTokenHash = await hashToken(browserToken);
    const authorization = await stub.authorizeBrowser(browserTokenHash);
    if (!authorization.ok) return jsonResponse({ error: authorization.code }, authorization.status, responseOrigin);
    const sessionRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `connect-session:${sessionId}` });
    if (!sessionRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, responseOrigin);
    const headers = new Headers(request.headers);
    headers.set("X-Relay-Browser-Token-Hash", browserTokenHash);
    headers.set("Sec-WebSocket-Protocol", RELAY_WEBSOCKET_PROTOCOL);
    const upgrade = await stub.fetch(new Request(request, { headers }));
    return upgrade.status === 101 ? upgrade : withCors(upgrade, responseOrigin);
  }

  if (request.method === "POST" && action === "deliveries") {
    if (origin && !allowedOrigins(env).has(origin)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const remoteIp = normalizeRateLimitSource(request.headers.get("CF-Connecting-IP"));
    const sourceRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `upload-source:${remoteIp}` });
    if (!sourceRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, responseOrigin);
    const uploadTokenHash = await hashToken(bearerToken(request));
    const authorization = await stub.authorizeUpload(uploadTokenHash);
    if (!authorization.ok) return jsonResponse({ error: authorization.code }, authorization.status, responseOrigin);
    const sessionRateLimit = await env.SESSION_UPLOAD_LIMITER.limit({ key: `upload-session:${sessionId}` });
    if (!sessionRateLimit.success) return jsonResponse({ error: "rate_limited" }, 429, responseOrigin);
    let value: unknown;
    try {
      value = await readJsonBody(request, MAX_UPLOAD_BODY_BYTES);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_json";
      return jsonResponse({ error: code }, code === "body_too_large" ? 413 : 400, responseOrigin);
    }
    const parsed = encryptedDeliverySchema.safeParse(value);
    if (!parsed.success) return jsonResponse({ error: "invalid_delivery" }, 400, responseOrigin);
    const result = await stub.upload(uploadTokenHash, parsed.data, await hashDeliveryEnvelope(parsed.data));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, responseOrigin);
    return jsonResponse({
      version: RELAY_PROTOCOL_VERSION,
      deliveryId: parsed.data.deliveryId,
      accepted: true,
      duplicate: result.value?.duplicate ?? false,
    }, result.status, responseOrigin);
  }

  if (request.method === "GET" && !action) {
    if (!responseOrigin) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const result = await stub.status(await hashToken(bearerToken(request)));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, responseOrigin);
    return jsonResponse({ version: RELAY_PROTOCOL_VERSION, ...result.value }, 200, responseOrigin);
  }

  if (request.method === "DELETE" && !action) {
    if (!responseOrigin) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const result = await stub.expire(await hashToken(bearerToken(request)));
    if (!result.ok) return jsonResponse({ error: result.code }, result.status, responseOrigin);
    return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) });
  }

  return jsonResponse({ error: "not_found" }, 404, responseOrigin);
}
