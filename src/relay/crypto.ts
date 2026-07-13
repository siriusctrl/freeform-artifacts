import {
  decryptedDeliverySchema,
  RELAY_PROTOCOL_VERSION,
  type DecryptedRelayDelivery,
  type EncryptedRelayDelivery,
} from "./protocol";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomCapability() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashCapability(capability: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function randomEncryptionKey() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function additionalData(sessionId: string, targetViewId: string, deliveryId: string) {
  return new TextEncoder().encode(
    `${RELAY_PROTOCOL_VERSION}\0${sessionId}\0${targetViewId}\0${deliveryId}`,
  );
}

async function importEncryptionKey(key: string) {
  return crypto.subtle.importKey("raw", base64UrlToBytes(key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function decryptRelayDelivery(
  delivery: EncryptedRelayDelivery,
  key: string,
  sessionId: string,
  targetViewId: string,
): Promise<DecryptedRelayDelivery> {
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64UrlToBytes(delivery.iv),
    additionalData: additionalData(sessionId, targetViewId, delivery.deliveryId),
  }, await importEncryptionKey(key), base64UrlToBytes(delivery.ciphertext));
  const parsed = decryptedDeliverySchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  if (parsed.deliveryId !== delivery.deliveryId) throw new Error("Encrypted delivery id does not match its envelope");
  if (parsed.bundles.length !== delivery.artifactCount) throw new Error("Encrypted delivery artifact count does not match its envelope");
  return parsed;
}

export async function encryptRelayDelivery(
  value: DecryptedRelayDelivery,
  key: string,
  sessionId: string,
  targetViewId: string,
) {
  const checked = decryptedDeliverySchema.parse(value);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: additionalData(sessionId, targetViewId, checked.deliveryId),
  }, await importEncryptionKey(key), new TextEncoder().encode(JSON.stringify(checked)));
  return {
    version: RELAY_PROTOCOL_VERSION,
    deliveryId: checked.deliveryId,
    artifactCount: checked.bundles.length,
    createdAt: new Date().toISOString(),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  } satisfies EncryptedRelayDelivery;
}
