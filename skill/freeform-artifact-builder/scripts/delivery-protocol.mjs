import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";

export const PROTOCOL_VERSION = 2;
export const MAX_ARTIFACTS = 12;
export const MAX_CIPHERTEXT_BYTES = 1_400_000;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_MODULE_SOURCE_LENGTH = 500_000;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const defaultFileSystem = Object.freeze({ readFile });

function fail(message) {
  throw new Error(message);
}

function decodeBase64Url(value) {
  if (!CAPABILITY_PATTERN.test(value)) fail("Encryption key must be a 32-byte base64url value");
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function payloadHash({ bundles, deliveryId, viewIncarnationId }) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: PROTOCOL_VERSION,
      deliveryId,
      targetViewIncarnationId: viewIncarnationId,
      bundles,
    }), "utf8")
    .digest("base64url");
}

export function validateCachedEnvelope(value, {
  bundles,
  deliveryId,
  encryptionKey,
  sessionId,
  viewId,
  viewIncarnationId,
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Cached retry envelope is invalid");
  const envelope = value.envelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    fail("Cached retry envelope is invalid");
  }
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
  decipher.setAAD(Buffer.from(
    `${PROTOCOL_VERSION}\0${sessionId}\0${viewId}\0${viewIncarnationId}\0${deliveryId}`,
    "utf8",
  ));
  decipher.setAuthTag(combined.subarray(combined.length - 16));
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
  } catch {
    fail("Cached retry envelope failed authentication");
  }
  const expectedPlaintext = Buffer.from(JSON.stringify({
    version: PROTOCOL_VERSION,
    deliveryId,
    bundles,
  }), "utf8");
  if (!plaintext.equals(expectedPlaintext)) fail("Cached retry envelope belongs to a different payload");
  return envelope;
}

export function validateRelayUrl(value) {
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
  if (url.username || url.password || url.search || url.hash) {
    fail("Relay URL must not contain credentials, query, or fragment");
  }
  return url;
}

export function validateBundle(value, bundlePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${bundlePath}: bundle must be an object`);
  if (value.version !== 1) fail(`${bundlePath}: version must be 1`);
  if (typeof value.artifactId !== "string" || !ARTIFACT_ID_PATTERN.test(value.artifactId)) {
    fail(`${bundlePath}: artifactId must be lowercase kebab-case`);
  }
  if (
    typeof value.moduleSource !== "string" ||
    value.moduleSource.length < 1 ||
    value.moduleSource.length > MAX_MODULE_SOURCE_LENGTH
  ) {
    fail(`${bundlePath}: moduleSource must contain 1-${MAX_MODULE_SOURCE_LENGTH} characters`);
  }
  const node = value.node;
  if (!node || typeof node !== "object" || Array.isArray(node)) fail(`${bundlePath}: node must be an object`);
  if (typeof node.title !== "string" || node.title.trim().length < 1 || node.title.trim().length > 80) {
    fail(`${bundlePath}: node.title must contain 1-80 characters`);
  }
  if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) {
    fail(`${bundlePath}: node.config must be an object`);
  }
  for (const coordinate of ["x", "y"]) {
    if (
      node[coordinate] !== undefined &&
      (typeof node[coordinate] !== "number" || !Number.isFinite(node[coordinate]))
    ) {
      fail(`${bundlePath}: node.${coordinate} must be a finite number`);
    }
  }
  try {
    JSON.stringify(value);
  } catch {
    fail(`${bundlePath}: bundle must be JSON serializable`);
  }
  return value;
}

export async function readBundles(paths, { fileSystem = defaultFileSystem } = {}) {
  if (paths.length < 1 || paths.length > MAX_ARTIFACTS) {
    fail(`Choose between 1 and ${MAX_ARTIFACTS} bundle files per delivery`);
  }
  const bundles = await Promise.all(paths.map(async (bundlePath) => {
    let source;
    try {
      source = await fileSystem.readFile(bundlePath, "utf8");
    } catch (error) {
      fail(`${bundlePath}: ${error instanceof Error ? error.message : "could not read file"}`);
    }
    let value;
    try {
      value = JSON.parse(source);
    } catch {
      fail(`${bundlePath}: file is not valid JSON`);
    }
    return validateBundle(value, bundlePath);
  }));
  const ids = new Set();
  for (const bundle of bundles) {
    if (ids.has(bundle.artifactId)) fail(`Duplicate artifactId in delivery: ${bundle.artifactId}`);
    ids.add(bundle.artifactId);
  }
  return bundles;
}

export function encryptDelivery({
  bundles,
  deliveryId,
  encryptionKey,
  sessionId,
  viewId,
  viewIncarnationId,
}) {
  const key = decodeBase64Url(encryptionKey);
  if (key.byteLength !== 32) fail("Encryption key must decode to exactly 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(
    `${PROTOCOL_VERSION}\0${sessionId}\0${viewId}\0${viewIncarnationId}\0${deliveryId}`,
    "utf8",
  ));
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
