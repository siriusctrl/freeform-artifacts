import { z } from "zod";

export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_SESSION_TTL_MS = 30 * 60 * 1_000;
export const RELAY_MAX_ARTIFACTS_PER_DELIVERY = 12;
export const RELAY_MAX_DELIVERIES_PER_SESSION = 24;
export const RELAY_MAX_CIPHERTEXT_BYTES = 2_000_000;
export const RELAY_MAX_PENDING_BYTES = 8_000_000;
export const RELAY_WEBSOCKET_PROTOCOL = "freeform-relay-v1";

const base64UrlSchema = z.string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => value.length % 4 !== 1, "Invalid base64url length");
const tokenHashSchema = base64UrlSchema.length(43);

export const relaySessionCreateSchema = z.object({
  version: z.literal(RELAY_PROTOCOL_VERSION),
  targetViewId: z.string().trim().min(1).max(160),
  browserTokenHash: tokenHashSchema,
  uploadTokenHash: tokenHashSchema,
  turnstileToken: z.string().min(1).max(4_096),
}).strict();

export const encryptedDeliverySchema = z.object({
  version: z.literal(RELAY_PROTOCOL_VERSION),
  deliveryId: z.string().uuid(),
  artifactCount: z.number().int().min(1).max(RELAY_MAX_ARTIFACTS_PER_DELIVERY),
  createdAt: z.string().datetime(),
  iv: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema.min(16),
}).strict();

export const decryptedDeliverySchema = z.object({
  version: z.literal(RELAY_PROTOCOL_VERSION),
  deliveryId: z.string().uuid(),
  bundles: z.array(z.unknown()).min(1).max(RELAY_MAX_ARTIFACTS_PER_DELIVERY),
}).strict();

export const relayClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal(RELAY_PROTOCOL_VERSION),
    type: z.literal("ack"),
    deliveryId: z.string().uuid(),
    outcome: z.enum(["installed", "rejected"]),
  }).strict(),
]);

export const relayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal(RELAY_PROTOCOL_VERSION),
    type: z.literal("ready"),
    sessionId: z.string().uuid(),
    targetViewId: z.string(),
    expiresAt: z.string().datetime(),
  }).strict(),
  z.object({
    version: z.literal(RELAY_PROTOCOL_VERSION),
    type: z.literal("delivery"),
    delivery: encryptedDeliverySchema,
  }).strict(),
  z.object({
    version: z.literal(RELAY_PROTOCOL_VERSION),
    type: z.literal("expired"),
  }).strict(),
  z.object({
    version: z.literal(RELAY_PROTOCOL_VERSION),
    type: z.literal("error"),
    code: z.string().max(80),
  }).strict(),
]);

export type RelaySessionCreate = z.infer<typeof relaySessionCreateSchema>;
export type EncryptedRelayDelivery = z.infer<typeof encryptedDeliverySchema>;
export type DecryptedRelayDelivery = z.infer<typeof decryptedDeliverySchema>;
export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;
export type RelayServerMessage = z.infer<typeof relayServerMessageSchema>;
