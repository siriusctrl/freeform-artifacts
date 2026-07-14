#!/usr/bin/env node

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_ARTIFACTS = 12;
const MAX_MODULE_SOURCE_LENGTH = 500_000;
const MAX_CIPHERTEXT_BYTES = 1_400_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CACHE_RETENTION_MS = 24 * 60 * 60 * 1_000;

function usage() {
  return `Usage:
  node deliver.mjs \\
    --relay-url <https://relay.example> \\
    --session-id <uuid> \\
    --credentials-stdin \\
    --view-id <target view id> \\
    [--delivery-id <uuid>] \\
    <one.freeform-artifact.json> [two.freeform-artifact.json ...]`;
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(values) {
  const options = {};
  const bundlePaths = [];
  const named = new Set([
    "--relay-url",
    "--session-id",
    "--view-id",
    "--delivery-id",
  ]);
  const flags = new Set(["--credentials-stdin"]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") return { help: true };
    if (!value.startsWith("--")) {
      bundlePaths.push(value);
      continue;
    }
    if (flags.has(value)) {
      options[value.slice(2)] = true;
      continue;
    }
    if (!named.has(value)) fail(`Unknown option: ${value}`);
    const optionValue = values[index + 1];
    if (!optionValue || optionValue.startsWith("--")) fail(`Missing value for ${value}`);
    options[value.slice(2)] = optionValue;
    index += 1;
  }
  return { help: false, options, bundlePaths };
}

async function readHiddenTtyLine() {
  const input = process.stdin;
  if (typeof input.setRawMode !== "function") {
    fail("This TTY cannot disable input echo; use pipe-backed stdin through the agent harness");
  }
  const wasRaw = Boolean(input.isRaw);
  process.stderr.write("Credential JSON (input hidden): ");
  return new Promise((resolve, reject) => {
    let source = "";
    let length = 0;
    const restore = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      process.stderr.write("\n");
    };
    const finish = (error) => {
      restore();
      if (error) reject(error);
      else resolve(source);
    };
    const onData = (chunk) => {
      for (const character of Buffer.from(chunk).toString("utf8")) {
        if (character === "\r" || character === "\n" || character === "\u0004") {
          finish();
          return;
        }
        if (character === "\u0003") {
          finish(new Error("Credential input cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          source = source.slice(0, -1);
          continue;
        }
        source += character;
        length += Buffer.byteLength(character);
        if (length > 4_096) {
          finish(new Error("Credential input is too large"));
          return;
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readCredentialsFromStdin() {
  if (process.stdin.isTTY) return parseCredentials(await readHiddenTtyLine());
  let source = "";
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > 4_096) fail("Credential input is too large");
    source += bytes.toString("utf8");
    const newline = source.indexOf("\n");
    if (newline >= 0) {
      source = source.slice(0, newline);
      break;
    }
  }
  return parseCredentials(source);
}

function parseCredentials(source) {
  let value;
  try {
    value = JSON.parse(source.trim());
  } catch {
    fail("Credential input must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Credential input must be an object");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "encryptionKey,uploadToken") {
    fail("Credential input must contain only uploadToken and encryptionKey");
  }
  if (!CAPABILITY_PATTERN.test(value.uploadToken)) fail("Upload token is invalid");
  if (!CAPABILITY_PATTERN.test(value.encryptionKey)) fail("Encryption key is invalid");
  return { uploadToken: value.uploadToken, encryptionKey: value.encryptionKey };
}

function decodeBase64Url(value) {
  if (!CAPABILITY_PATTERN.test(value)) fail("Encryption key must be a 32-byte base64url value");
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function deliveryCacheRoot() {
  const platformCache = process.env.FREEFORM_RELAY_CACHE_DIR
    ? path.resolve(process.env.FREEFORM_RELAY_CACHE_DIR)
    : process.platform === "win32"
    ? process.env.LOCALAPPDATA
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  if (!platformCache) fail("Unable to resolve a private delivery retry cache directory");
  return path.join(platformCache, "freeform-artifacts", "relay-deliveries");
}

function payloadHash({ bundles, deliveryId }) {
  return createHash("sha256")
    .update(JSON.stringify({ version: PROTOCOL_VERSION, deliveryId, bundles }), "utf8")
    .digest("base64url");
}

async function pruneDeliveryCache(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    return;
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name)).map(async (entry) => {
    const directory = path.join(root, entry.name);
    try {
      const marker = await readFile(path.join(directory, ".freeform-relay-session"), "utf8");
      if (marker.trim() !== entry.name) return;
      const metadata = await stat(directory);
      if (Date.now() - metadata.mtimeMs > CACHE_RETENTION_MS) await rm(directory, { recursive: true, force: true });
    } catch {
      // Retry cache cleanup is best-effort and never changes delivery semantics.
    }
  }));
}

function validateCachedEnvelope(value, { bundles, deliveryId, encryptionKey, sessionId, viewId }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Cached retry envelope is invalid");
  const envelope = value.envelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) fail("Cached retry envelope is invalid");
  if (
    envelope.version !== PROTOCOL_VERSION ||
    envelope.deliveryId !== deliveryId ||
    envelope.artifactCount !== bundles.length ||
    typeof envelope.createdAt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    fail("Cached retry envelope is invalid");
  }
  let iv;
  let combined;
  try {
    iv = Buffer.from(envelope.iv, "base64url");
    combined = Buffer.from(envelope.ciphertext, "base64url");
  } catch {
    fail("Cached retry envelope is invalid");
  }
  if (iv.byteLength !== 12 || combined.byteLength <= 16) fail("Cached retry envelope is invalid");
  const key = decodeBase64Url(encryptionKey);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${PROTOCOL_VERSION}\0${sessionId}\0${viewId}\0${deliveryId}`, "utf8"));
  decipher.setAuthTag(combined.subarray(combined.length - 16));
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
  } catch {
    fail("Cached retry envelope failed authentication");
  }
  const expectedPlaintext = Buffer.from(JSON.stringify({ version: PROTOCOL_VERSION, deliveryId, bundles }), "utf8");
  if (!plaintext.equals(expectedPlaintext)) fail("Cached retry envelope belongs to a different payload");
  return envelope;
}

async function deliveryForUpload({ bundles, deliveryId, encryptionKey, sessionId, viewId, retry }) {
  const root = deliveryCacheRoot();
  const sessionDirectory = path.join(root, sessionId);
  const cachePath = path.join(sessionDirectory, `${deliveryId}.json`);
  const expectedPayloadHash = payloadHash({ bundles, deliveryId });
  await pruneDeliveryCache(root);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      cached.version !== PROTOCOL_VERSION ||
      cached.sessionId !== sessionId ||
      cached.targetViewId !== viewId ||
      cached.payloadHash !== expectedPayloadHash
    ) {
      fail("Delivery id belongs to a different cached payload; generate a new delivery id");
    }
    return { envelope: validateCachedEnvelope(cached, {
      bundles, deliveryId, encryptionKey, sessionId, viewId,
    }), cachePath };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (retry) {
    fail("No cached ciphertext exists for this delivery id; retry on the original machine or omit --delivery-id for a new delivery");
  }

  const envelope = encryptDelivery({ bundles, deliveryId, encryptionKey, sessionId, viewId });
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  await chmod(sessionDirectory, 0o700).catch(() => undefined);
  await writeFile(path.join(sessionDirectory, ".freeform-relay-session"), `${sessionId}\n`, {
    encoding: "utf8", mode: 0o600, flag: "w",
  });
  const temporaryPath = `${cachePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({
    version: PROTOCOL_VERSION,
    sessionId,
    targetViewId: viewId,
    payloadHash: expectedPayloadHash,
    cachedAt: new Date().toISOString(),
    envelope,
  })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await link(temporaryPath, cachePath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const winner = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      winner.version !== PROTOCOL_VERSION ||
      winner.sessionId !== sessionId ||
      winner.targetViewId !== viewId ||
      winner.payloadHash !== expectedPayloadHash
    ) {
      fail("Delivery id belongs to a different cached payload; generate a new delivery id");
    }
    return { envelope: validateCachedEnvelope(winner, {
      bundles, deliveryId, encryptionKey, sessionId, viewId,
    }), cachePath };
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  await chmod(cachePath, 0o600).catch(() => undefined);
  return { envelope, cachePath };
}

async function removeRetryCache(cachePath) {
  await unlink(cachePath).catch(() => undefined);
}

function validateRelayUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Relay URL is invalid");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    fail("Relay URL must use HTTPS (HTTP is accepted only for a local emulator)");
  }
  if (url.username || url.password || url.search || url.hash) fail("Relay URL must not contain credentials, query, or fragment");
  return url;
}

function validateBundle(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path}: bundle must be an object`);
  if (value.version !== 1) fail(`${path}: version must be 1`);
  if (typeof value.artifactId !== "string" || !ARTIFACT_ID_PATTERN.test(value.artifactId)) {
    fail(`${path}: artifactId must be lowercase kebab-case`);
  }
  if (typeof value.moduleSource !== "string" || value.moduleSource.length < 1 || value.moduleSource.length > MAX_MODULE_SOURCE_LENGTH) {
    fail(`${path}: moduleSource must contain 1-${MAX_MODULE_SOURCE_LENGTH} characters`);
  }
  const node = value.node;
  if (!node || typeof node !== "object" || Array.isArray(node)) fail(`${path}: node must be an object`);
  if (typeof node.title !== "string" || node.title.trim().length < 1 || node.title.trim().length > 80) {
    fail(`${path}: node.title must contain 1-80 characters`);
  }
  if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) {
    fail(`${path}: node.config must be an object`);
  }
  for (const coordinate of ["x", "y"]) {
    if (node[coordinate] !== undefined && (typeof node[coordinate] !== "number" || !Number.isFinite(node[coordinate]))) {
      fail(`${path}: node.${coordinate} must be a finite number`);
    }
  }
  try {
    JSON.stringify(value);
  } catch {
    fail(`${path}: bundle must be JSON serializable`);
  }
  return value;
}

async function readBundles(paths) {
  if (paths.length < 1 || paths.length > MAX_ARTIFACTS) {
    fail(`Choose between 1 and ${MAX_ARTIFACTS} bundle files per delivery`);
  }
  const bundles = await Promise.all(paths.map(async (path) => {
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      fail(`${path}: ${error instanceof Error ? error.message : "could not read file"}`);
    }
    let value;
    try {
      value = JSON.parse(source);
    } catch {
      fail(`${path}: file is not valid JSON`);
    }
    return validateBundle(value, path);
  }));
  const ids = new Set();
  for (const bundle of bundles) {
    if (ids.has(bundle.artifactId)) fail(`Duplicate artifactId in delivery: ${bundle.artifactId}`);
    ids.add(bundle.artifactId);
  }
  return bundles;
}

function encryptDelivery({ bundles, deliveryId, encryptionKey, sessionId, viewId }) {
  const key = decodeBase64Url(encryptionKey);
  if (key.byteLength !== 32) fail("Encryption key must decode to exactly 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${PROTOCOL_VERSION}\0${sessionId}\0${viewId}\0${deliveryId}`, "utf8"));
  const plaintext = Buffer.from(JSON.stringify({ version: PROTOCOL_VERSION, deliveryId, bundles }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  if (ciphertext.byteLength > MAX_CIPHERTEXT_BYTES) {
    fail(`Encrypted delivery exceeds the ${MAX_CIPHERTEXT_BYTES}-byte relay limit; split it into smaller deliveries`);
  }
  return {
    version: PROTOCOL_VERSION,
    deliveryId,
    artifactCount: bundles.length,
    createdAt: new Date().toISOString(),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class RelayUploadError extends Error {
  constructor(message, outcome) {
    super(message);
    this.name = "RelayUploadError";
    this.outcome = outcome;
  }
}

async function uploadDelivery(url, token, delivery) {
  let lastError;
  let sawAmbiguousOutcome = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Relay request timed out")), 15_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(delivery),
        signal: controller.signal,
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        // Preserve the status-based error below without reflecting an HTML body.
      }
      if (response.ok && body.accepted === true && body.deliveryId === delivery.deliveryId) return body;
      const code = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      if (!response.ok && response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw new RelayUploadError(
          `Relay rejected delivery: ${code}`,
          sawAmbiguousOutcome ? "unknown" : "rejected",
        );
      }
      if (response.ok || response.status >= 500 || response.status === 408) sawAmbiguousOutcome = true;
      lastError = new Error(response.ok
        ? "Relay returned an invalid acknowledgement"
        : `Relay temporarily refused delivery: ${code}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Relay request failed");
      if (lastError instanceof RelayUploadError) throw lastError;
      sawAmbiguousOutcome = true;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await delay(500 * 2 ** attempt);
  }
  throw new RelayUploadError(
    lastError?.message ?? "Relay request failed",
    sawAmbiguousOutcome ? "unknown" : "rejected",
  );
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { options, bundlePaths } = parsed;
  for (const name of ["relay-url", "session-id", "view-id"]) {
    if (!options[name]) fail(`Missing --${name}\n\n${usage()}`);
  }
  if (!options["credentials-stdin"]) fail(`Missing --credentials-stdin\n\n${usage()}`);
  if (!UUID_PATTERN.test(options["session-id"])) fail("Session id must be a UUID");
  if (!options["view-id"].trim() || options["view-id"].length > 160) fail("View id must contain 1-160 characters");
  const deliveryId = options["delivery-id"] ?? randomUUID();
  if (!UUID_PATTERN.test(deliveryId)) fail("Delivery id must be a UUID");

  const relayUrl = validateRelayUrl(options["relay-url"]);
  const basePath = relayUrl.pathname.replace(/\/+$/, "");
  relayUrl.pathname = `${basePath}/v1/sessions/${options["session-id"]}/deliveries`;
  const credentials = await readCredentialsFromStdin();
  const bundles = await readBundles(bundlePaths);
  const cachedDelivery = await deliveryForUpload({
    bundles,
    deliveryId,
    encryptionKey: credentials.encryptionKey,
    sessionId: options["session-id"],
    viewId: options["view-id"],
    retry: Boolean(options["delivery-id"]),
  });
  const delivery = cachedDelivery.envelope;
  let response;
  try {
    response = await uploadDelivery(relayUrl, credentials.uploadToken, delivery);
  } catch (error) {
    const failure = error instanceof RelayUploadError ? error : new RelayUploadError(
      error instanceof Error ? error.message : "Relay request failed",
      "unknown",
    );
    failure.context = {
      version: PROTOCOL_VERSION,
      accepted: false,
      outcome: failure.outcome,
      deliveryId,
      artifactIds: bundles.map((bundle) => bundle.artifactId),
      targetViewId: options["view-id"],
    };
    if (failure.outcome === "rejected") await removeRetryCache(cachedDelivery.cachePath);
    throw failure;
  }
  await removeRetryCache(cachedDelivery.cachePath);
  process.stdout.write(`${JSON.stringify({
    version: PROTOCOL_VERSION,
    accepted: true,
    outcome: "relay_accepted",
    browserInstalled: false,
    duplicate: response.duplicate === true,
    deliveryId,
    artifactIds: bundles.map((bundle) => bundle.artifactId),
    targetViewId: options["view-id"],
  }, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  if (error instanceof RelayUploadError && error.context) {
    process.stdout.write(`${JSON.stringify({ ...error.context, error: message }, null, 2)}\n`);
    if (error.outcome === "unknown") {
      process.stderr.write(`Delivery outcome is unknown. Retry the same bundles with --delivery-id ${error.context.deliveryId}; do not generate a new id.\n`);
    }
  } else {
    process.stderr.write(`Delivery failed: ${message}\n`);
  }
  process.exitCode = 1;
});
