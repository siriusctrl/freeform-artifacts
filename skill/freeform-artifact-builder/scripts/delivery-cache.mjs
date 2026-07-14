import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PROTOCOL_VERSION,
  UUID_PATTERN,
  encryptDelivery,
  payloadHash,
  validateCachedEnvelope,
} from "./delivery-protocol.mjs";

const CACHE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export const defaultFileSystem = Object.freeze({
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
});

export class RetryCacheError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryCacheError";
  }
}

export function deliveryCacheRoot({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
} = {}) {
  const platformCache = env.FREEFORM_RELAY_CACHE_DIR
    ? path.resolve(env.FREEFORM_RELAY_CACHE_DIR)
    : platform === "win32"
      ? env.LOCALAPPDATA
      : platform === "darwin"
        ? path.join(homedir(), "Library", "Caches")
        : env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache");
  if (!platformCache) throw new Error("Unable to resolve a private delivery retry cache directory");
  return path.join(platformCache, "freeform-artifacts", "relay-deliveries");
}

function isPosix(platform) {
  return platform !== "win32";
}

function fileMode(metadata) {
  return metadata.mode & 0o777;
}

async function assertPrivateDirectory(directory, { fileSystem, platform }) {
  let metadata;
  try {
    metadata = await fileSystem.lstat(directory);
  } catch {
    throw new RetryCacheError("Unable to inspect the delivery retry cache directory");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RetryCacheError("Delivery retry cache directory is not a private directory");
  }
  if (isPosix(platform) && fileMode(metadata) !== PRIVATE_DIRECTORY_MODE) {
    throw new RetryCacheError("Delivery retry cache directory must use mode 0700");
  }
}

async function ensurePrivateDirectory(directory, { fileSystem, platform }) {
  try {
    await fileSystem.mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const metadata = await fileSystem.lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new RetryCacheError("Delivery retry cache directory is not a private directory");
    }
    if (isPosix(platform)) await fileSystem.chmod(directory, PRIVATE_DIRECTORY_MODE);
  } catch (error) {
    if (error instanceof RetryCacheError) throw error;
    throw new RetryCacheError("Unable to secure the delivery retry cache directory");
  }
  await assertPrivateDirectory(directory, { fileSystem, platform });
}

async function assertPrivateFile(file, { fileSystem, platform }) {
  let metadata;
  try {
    metadata = await fileSystem.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw new RetryCacheError("Unable to inspect a delivery retry cache file");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new RetryCacheError("Delivery retry cache entry is not a private file");
  }
  if (isPosix(platform) && fileMode(metadata) !== PRIVATE_FILE_MODE) {
    throw new RetryCacheError("Delivery retry cache files must use mode 0600");
  }
}

async function writePrivateFile(file, source, options, { fileSystem, platform }) {
  try {
    await fileSystem.writeFile(file, source, { ...options, mode: PRIVATE_FILE_MODE });
    if (isPosix(platform)) await fileSystem.chmod(file, PRIVATE_FILE_MODE);
  } catch {
    throw new RetryCacheError("Unable to write a private delivery retry cache file");
  }
  await assertPrivateFile(file, { fileSystem, platform });
}

async function pruneDeliveryCache(root, { fileSystem, now = Date.now }) {
  let entries;
  try {
    entries = await fileSystem.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
    .map(async (entry) => {
      const directory = path.join(root, entry.name);
      try {
        const marker = await fileSystem.readFile(path.join(directory, ".freeform-relay-session"), "utf8");
        if (marker.trim() !== entry.name) return;
        const metadata = await fileSystem.lstat(directory);
        if (now() - metadata.mtimeMs > CACHE_RETENTION_MS) {
          await fileSystem.rm(directory, { recursive: true, force: true });
        }
      } catch {
        // Opportunistic pruning never changes current delivery semantics.
      }
    }));
}

export async function removeRetryCache(cachePath, { unlinkFile = unlink } = {}) {
  try {
    await unlinkFile(cachePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new RetryCacheError("Unable to remove the delivery retry cache after a definitive relay outcome");
  }
}

export async function deliveryForUpload({
  bundles,
  deliveryId,
  encryptionKey,
  sessionId,
  viewId,
  viewIncarnationId,
  retry,
}, {
  fileSystem = defaultFileSystem,
  platform = process.platform,
  env = process.env,
  homedir = os.homedir,
  now = Date.now,
} = {}) {
  const root = deliveryCacheRoot({ env, platform, homedir });
  const sessionDirectory = path.join(root, sessionId);
  const cachePath = path.join(sessionDirectory, `${deliveryId}.json`);
  const expectedPayloadHash = payloadHash({ bundles, deliveryId, viewIncarnationId });
  await ensurePrivateDirectory(root, { fileSystem, platform });
  await pruneDeliveryCache(root, { fileSystem, now });
  await ensurePrivateDirectory(sessionDirectory, { fileSystem, platform });
  try {
    await assertPrivateFile(cachePath, { fileSystem, platform });
    const cached = JSON.parse(await fileSystem.readFile(cachePath, "utf8"));
    if (
      cached.version !== PROTOCOL_VERSION ||
      cached.sessionId !== sessionId ||
      cached.targetViewId !== viewId ||
      cached.targetViewIncarnationId !== viewIncarnationId ||
      cached.payloadHash !== expectedPayloadHash
    ) {
      throw new Error("Delivery id belongs to a different cached payload; generate a new delivery id");
    }
    return {
      envelope: validateCachedEnvelope(cached, {
        bundles, deliveryId, encryptionKey, sessionId, viewId, viewIncarnationId,
      }),
      cachePath,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (retry) {
    throw new Error("No cached ciphertext exists for this delivery id; retry on the original machine or omit --delivery-id for a new delivery");
  }

  const envelope = encryptDelivery({
    bundles,
    deliveryId,
    encryptionKey,
    sessionId,
    viewId,
    viewIncarnationId,
  });
  await writePrivateFile(path.join(sessionDirectory, ".freeform-relay-session"), `${sessionId}\n`, {
    encoding: "utf8", flag: "w",
  }, { fileSystem, platform });
  const temporaryPath = `${cachePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writePrivateFile(temporaryPath, `${JSON.stringify({
    version: PROTOCOL_VERSION,
    sessionId,
    targetViewId: viewId,
    targetViewIncarnationId: viewIncarnationId,
    payloadHash: expectedPayloadHash,
    cachedAt: new Date(now()).toISOString(),
    envelope,
  })}\n`, { encoding: "utf8", flag: "wx" }, { fileSystem, platform });
  try {
    await fileSystem.link(temporaryPath, cachePath);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw new RetryCacheError("Unable to stage the delivery retry cache atomically");
    }
    await assertPrivateFile(cachePath, { fileSystem, platform });
    const winner = JSON.parse(await fileSystem.readFile(cachePath, "utf8"));
    if (
      winner.version !== PROTOCOL_VERSION ||
      winner.sessionId !== sessionId ||
      winner.targetViewId !== viewId ||
      winner.targetViewIncarnationId !== viewIncarnationId ||
      winner.payloadHash !== expectedPayloadHash
    ) {
      throw new Error("Delivery id belongs to a different cached payload; generate a new delivery id");
    }
    return {
      envelope: validateCachedEnvelope(winner, {
        bundles, deliveryId, encryptionKey, sessionId, viewId, viewIncarnationId,
      }),
      cachePath,
    };
  } finally {
    await removeRetryCache(temporaryPath, { unlinkFile: fileSystem.unlink });
  }
  if (isPosix(platform)) {
    try {
      await fileSystem.chmod(cachePath, PRIVATE_FILE_MODE);
    } catch {
      throw new RetryCacheError("Unable to secure a delivery retry cache file");
    }
  }
  await assertPrivateFile(cachePath, { fileSystem, platform });
  return { envelope, cachePath };
}
