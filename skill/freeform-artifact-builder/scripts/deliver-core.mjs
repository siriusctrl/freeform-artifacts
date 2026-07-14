import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  defaultFileSystem,
  deliveryForUpload,
  removeRetryCache,
} from "./delivery-cache.mjs";
import {
  parseArguments,
  readCredentialsFromStdin,
  usage,
} from "./delivery-input.mjs";
import {
  PROTOCOL_VERSION,
  UUID_PATTERN,
  readBundles,
  validateRelayUrl,
} from "./delivery-protocol.mjs";
import {
  RelayUploadError,
  delay,
  uploadDelivery,
} from "./delivery-upload.mjs";

export {
  RetryCacheError,
  deliveryCacheRoot,
  deliveryForUpload,
  removeRetryCache,
} from "./delivery-cache.mjs";
export {
  consumeHiddenTtyText,
  parseArguments,
  parseCredentials,
  readCredentialsFromStdin,
  readHiddenTtyLine,
  usage,
} from "./delivery-input.mjs";
export {
  MAX_ARTIFACTS,
  MAX_CIPHERTEXT_BYTES,
  PROTOCOL_VERSION,
  encryptDelivery,
  readBundles,
  validateBundle,
  validateRelayUrl,
} from "./delivery-protocol.mjs";
export {
  RelayUploadError,
  uploadDelivery,
} from "./delivery-upload.mjs";

function fail(message) {
  throw new Error(message);
}

function withContext(error, context) {
  error.context = context;
  return error;
}

export async function executeDelivery(argv, runtime = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };
  const { options, bundlePaths } = parsed;
  for (const name of ["relay-url", "session-id", "view-id", "view-incarnation-id"]) {
    if (!options[name]) fail(`Missing --${name}\n\n${usage()}`);
  }
  if (!options["credentials-stdin"]) fail(`Missing --credentials-stdin\n\n${usage()}`);
  if (!UUID_PATTERN.test(options["session-id"])) fail("Session id must be a UUID");
  if (!options["view-id"].trim() || options["view-id"].length > 160) {
    fail("View id must contain 1-160 characters");
  }
  if (!options["view-incarnation-id"].trim() || options["view-incarnation-id"].length > 200) {
    fail("View incarnation id must contain 1-200 characters");
  }
  const deliveryId = options["delivery-id"] ?? randomUUID();
  if (!UUID_PATTERN.test(deliveryId)) fail("Delivery id must be a UUID");

  const relayUrl = validateRelayUrl(options["relay-url"]);
  const basePath = relayUrl.pathname.replace(/\/+$/, "");
  relayUrl.pathname = `${basePath}/v1/sessions/${options["session-id"]}/deliveries`;
  const credentials = await readCredentialsFromStdin(runtime.input, runtime.errorOutput);
  const bundles = await readBundles(bundlePaths, { fileSystem: runtime.fileSystem });
  const cachedDelivery = await deliveryForUpload({
    bundles,
    deliveryId,
    encryptionKey: credentials.encryptionKey,
    sessionId: options["session-id"],
    viewId: options["view-id"],
    viewIncarnationId: options["view-incarnation-id"],
    retry: Boolean(options["delivery-id"]),
  }, {
    fileSystem: runtime.fileSystem,
    platform: runtime.platform,
    env: runtime.env,
    homedir: runtime.homedir,
    now: runtime.now,
  });
  const context = {
    version: PROTOCOL_VERSION,
    accepted: false,
    deliveryId,
    artifactIds: bundles.map((bundle) => bundle.artifactId),
    targetViewId: options["view-id"],
  };
  let response;
  try {
    response = await uploadDelivery(relayUrl, credentials.uploadToken, cachedDelivery.envelope, {
      fetchImpl: runtime.fetchImpl,
      wait: runtime.wait,
    });
  } catch (error) {
    const failure = error instanceof RelayUploadError
      ? error
      : new RelayUploadError("Relay request failed", "unknown");
    const failureContext = { ...context, outcome: failure.outcome };
    if (failure.outcome === "rejected") {
      try {
        await removeRetryCache(cachedDelivery.cachePath, { unlinkFile: runtime.fileSystem?.unlink });
      } catch (cleanupError) {
        throw withContext(cleanupError, { ...failureContext, cacheCleanup: false });
      }
    }
    throw withContext(failure, failureContext);
  }
  const result = {
    ...context,
    accepted: true,
    outcome: "relay_accepted",
    browserInstalled: false,
    duplicate: response.duplicate === true,
  };
  try {
    await removeRetryCache(cachedDelivery.cachePath, { unlinkFile: runtime.fileSystem?.unlink });
  } catch (cleanupError) {
    throw withContext(cleanupError, { ...result, cacheCleanup: false });
  }
  return result;
}

function defaultRuntime(overrides) {
  return {
    input: process.stdin,
    output: process.stdout,
    errorOutput: process.stderr,
    fileSystem: defaultFileSystem,
    platform: process.platform,
    env: process.env,
    homedir: os.homedir,
    now: Date.now,
    fetchImpl: globalThis.fetch,
    wait: delay,
    ...overrides,
  };
}

export async function runDeliveryCli(argv = process.argv.slice(2), overrides = {}) {
  const runtime = defaultRuntime(overrides);
  try {
    const result = await executeDelivery(argv, runtime);
    if (result.help) runtime.output.write(`${usage()}\n`);
    else runtime.output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (error?.context) {
      runtime.output.write(`${JSON.stringify({ ...error.context, error: message }, null, 2)}\n`);
      if (error instanceof RelayUploadError && error.outcome === "unknown") {
        runtime.errorOutput.write(`Delivery outcome is unknown. Retry the same bundles with --delivery-id ${error.context.deliveryId}; do not generate a new id.\n`);
      } else {
        runtime.errorOutput.write(`Delivery failed: ${message}\n`);
      }
    } else {
      runtime.errorOutput.write(`Delivery failed: ${message}\n`);
    }
    return 1;
  }
}
