import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  appendFile,
  copyFile,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  MAX_ARTIFACTS,
  MAX_CIPHERTEXT_BYTES,
  PROTOCOL_VERSION,
  RetryCacheError,
  consumeHiddenTtyText,
  deliveryCacheRoot,
  deliveryForUpload,
  encryptDelivery,
  readHiddenTtyLine,
  removeRetryCache,
  runDeliveryCli,
} from "../skill/freeform-artifact-builder/scripts/deliver-core.mjs";
import {
  parseUploadAcknowledgement,
  uploadDelivery,
} from "../skill/freeform-artifact-builder/scripts/delivery-upload.mjs";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "22222222-2222-4222-8222-222222222222";
const VIEW_ID = "market-overview";
const VIEW_INCARNATION_ID = "33333333-3333-4333-8333-333333333333";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const UPLOAD_TOKEN = Buffer.alloc(32, 9).toString("base64url");
const BUNDLE = {
  version: 1,
  artifactId: "relay-test",
  moduleSource: "export const artifact = {};",
  node: { title: "Relay test", data: {}, config: {} },
};

function mode(metadata) {
  return metadata.mode & 0o777;
}

async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "freeform-deliver-test-"));
}

async function runNode(arguments_) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("hidden TTY parsing decrements the UTF-8 byte count on backspace", () => {
  let state = { source: "", byteLength: 0, complete: false, error: null };
  state = consumeHiddenTtyText(state, "a😀");
  assert.equal(state.byteLength, 5);
  state = consumeHiddenTtyText(state, "\u007f");
  assert.equal(state.source, "a");
  assert.equal(state.byteLength, 1);
  state = consumeHiddenTtyText(state, "bc\n", 3);
  assert.deepEqual(state, {
    source: "abc",
    byteLength: 3,
    complete: true,
    error: null,
  });
});

test("hidden TTY input handles split UTF-8 and never echoes credentials", async () => {
  class FakeTty extends EventEmitter {
    isRaw = false;
    isTTY = true;
    pause() {}
    resume() {}
    setRawMode(value) { this.isRaw = value; }
  }
  const input = new FakeTty();
  let prompt = "";
  const result = readHiddenTtyLine({ input, errorOutput: { write: (value) => { prompt += value; } } });
  const source = Buffer.from("{\"label\":\"😀\"}\n", "utf8");
  input.emit("data", source.subarray(0, 13));
  input.emit("data", source.subarray(13));
  assert.equal(await result, "{\"label\":\"😀\"}");
  assert.equal(prompt, "Credential JSON (input hidden): \n");
  assert.equal(input.isRaw, false);
});

test("definitive cache deletion ignores only ENOENT", async () => {
  await removeRetryCache("unused", {
    unlinkFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
  });

  await assert.rejects(
    removeRetryCache("unused", {
      unlinkFile: async () => { throw Object.assign(new Error("secret path"), { code: "EACCES" }); },
    }),
    (error) => error instanceof RetryCacheError &&
      error.message === "Unable to remove the delivery retry cache after a definitive relay outcome" &&
      !error.message.includes("secret path"),
  );
});

test("retry cache enforces POSIX 0700 directories and 0600 files", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits are not available on Windows");
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const cached = await deliveryForUpload({
    bundles: [BUNDLE],
    deliveryId: DELIVERY_ID,
    encryptionKey: ENCRYPTION_KEY,
    sessionId: SESSION_ID,
    viewId: VIEW_ID,
    viewIncarnationId: VIEW_INCARNATION_ID,
    retry: false,
  }, { env: { FREEFORM_RELAY_CACHE_DIR: temporary } });
  const root = path.join(temporary, "freeform-artifacts", "relay-deliveries");
  const session = path.join(root, SESSION_ID);
  assert.equal(mode(await stat(root)), 0o700);
  assert.equal(mode(await stat(session)), 0o700);
  assert.equal(mode(await stat(path.join(session, ".freeform-relay-session"))), 0o600);
  assert.equal(mode(await stat(cached.cachePath)), 0o600);

  await assert.rejects(
    deliveryForUpload({
      bundles: [BUNDLE],
      deliveryId: DELIVERY_ID,
      encryptionKey: ENCRYPTION_KEY,
      sessionId: SESSION_ID,
      viewId: VIEW_ID,
      viewIncarnationId: "44444444-4444-4444-8444-444444444444",
      retry: true,
    }, { env: { FREEFORM_RELAY_CACHE_DIR: temporary } }),
    /different cached payload/,
  );

  await chmod(cached.cachePath, 0o640);
  await assert.rejects(
    deliveryForUpload({
      bundles: [BUNDLE],
      deliveryId: DELIVERY_ID,
      encryptionKey: ENCRYPTION_KEY,
      sessionId: SESSION_ID,
      viewId: VIEW_ID,
      viewIncarnationId: VIEW_INCARNATION_ID,
      retry: true,
    }, { env: { FREEFORM_RELAY_CACHE_DIR: temporary } }),
    /must use mode 0600/,
  );
});

test("retry cache prunes expired owned session directories only", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const env = { FREEFORM_RELAY_CACHE_DIR: temporary };
  const root = deliveryCacheRoot({ env });
  const expiredSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const unownedSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const expiredDirectory = path.join(root, expiredSessionId);
  const unownedDirectory = path.join(root, unownedSessionId);
  await mkdir(expiredDirectory, { recursive: true, mode: 0o700 });
  await mkdir(unownedDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(expiredDirectory, ".freeform-relay-session"), `${expiredSessionId}\n`, { mode: 0o600 });
  await writeFile(path.join(expiredDirectory, "stale.json"), "ciphertext", { mode: 0o600 });
  await writeFile(path.join(unownedDirectory, ".freeform-relay-session"), "different-session\n", { mode: 0o600 });
  const now = Date.UTC(2026, 0, 3);
  const staleTime = new Date(now - 48 * 60 * 60 * 1_000);
  await utimes(expiredDirectory, staleTime, staleTime);
  await utimes(unownedDirectory, staleTime, staleTime);

  await deliveryForUpload({
    bundles: [BUNDLE],
    deliveryId: DELIVERY_ID,
    encryptionKey: ENCRYPTION_KEY,
    sessionId: SESSION_ID,
    viewId: VIEW_ID,
    viewIncarnationId: VIEW_INCARNATION_ID,
    retry: false,
  }, { env, now: () => now });

  await assert.rejects(
    lstat(expiredDirectory),
    (error) => error?.code === "ENOENT",
  );
  assert.equal((await lstat(unownedDirectory)).isDirectory(), true);
});

test("retry cache rejects ciphertext corruption that fails authentication", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const env = { FREEFORM_RELAY_CACHE_DIR: temporary };
  const request = {
    bundles: [BUNDLE],
    deliveryId: DELIVERY_ID,
    encryptionKey: ENCRYPTION_KEY,
    sessionId: SESSION_ID,
    viewId: VIEW_ID,
    viewIncarnationId: VIEW_INCARNATION_ID,
  };
  const cached = await deliveryForUpload({ ...request, retry: false }, { env });
  const value = JSON.parse(await readFile(cached.cachePath, "utf8"));
  const ciphertext = value.envelope.ciphertext;
  value.envelope.ciphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  await writeFile(cached.cachePath, `${JSON.stringify(value)}\n`);

  await assert.rejects(
    deliveryForUpload({ ...request, retry: true }, { env }),
    /Cached retry envelope failed authentication/,
  );
});

test("concurrent retry-cache creation adopts the hard-link winner after EEXIST", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let linkAttempts = 0;
  let eexistCount = 0;
  let releaseLinks;
  const bothLinksReady = new Promise((resolve) => { releaseLinks = resolve; });
  const fileSystem = {
    chmod,
    lstat,
    mkdir,
    readFile,
    readdir,
    rm,
    unlink,
    writeFile,
    link: async (...arguments_) => {
      linkAttempts += 1;
      if (linkAttempts === 2) releaseLinks();
      await bothLinksReady;
      try {
        return await link(...arguments_);
      } catch (error) {
        if (error?.code === "EEXIST") eexistCount += 1;
        throw error;
      }
    },
  };
  const request = {
    bundles: [BUNDLE],
    deliveryId: DELIVERY_ID,
    encryptionKey: ENCRYPTION_KEY,
    sessionId: SESSION_ID,
    viewId: VIEW_ID,
    viewIncarnationId: VIEW_INCARNATION_ID,
    retry: false,
  };
  const options = {
    env: { FREEFORM_RELAY_CACHE_DIR: temporary },
    fileSystem,
  };

  const [first, second] = await Promise.all([
    deliveryForUpload(request, options),
    deliveryForUpload(request, options),
  ]);
  assert.equal(linkAttempts, 2);
  assert.equal(eexistCount, 1);
  assert.deepEqual(first.envelope, second.envelope);
  assert.equal(first.cachePath, second.cachePath);
});

test("protocol constants and v2 AAD stay aligned with the browser contract", async () => {
  const protocolSource = await readFile(new URL("../src/relay/protocol.ts", import.meta.url), "utf8");
  assert.match(protocolSource, new RegExp(`RELAY_PROTOCOL_VERSION = ${PROTOCOL_VERSION}\\b`));
  assert.match(protocolSource, new RegExp(`RELAY_MAX_ARTIFACTS_PER_DELIVERY = ${MAX_ARTIFACTS}\\b`));
  const formattedCiphertextLimit = MAX_CIPHERTEXT_BYTES.toLocaleString("en-US").replaceAll(",", "_");
  assert.match(protocolSource, new RegExp(`RELAY_MAX_CIPHERTEXT_BYTES = ${formattedCiphertextLimit}\\b`));

  const envelope = encryptDelivery({
    bundles: [BUNDLE],
    deliveryId: DELIVERY_ID,
    encryptionKey: ENCRYPTION_KEY,
    sessionId: SESSION_ID,
    viewId: VIEW_ID,
    viewIncarnationId: VIEW_INCARNATION_ID,
  });
  const combined = Buffer.from(envelope.ciphertext, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "base64url"), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(`${PROTOCOL_VERSION}\0${SESSION_ID}\0${VIEW_ID}\0${VIEW_INCARNATION_ID}\0${DELIVERY_ID}`));
  decipher.setAuthTag(combined.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
  assert.deepEqual(JSON.parse(plaintext.toString("utf8")), {
    version: PROTOCOL_VERSION,
    deliveryId: DELIVERY_ID,
    bundles: [BUNDLE],
  });

  const wrongIncarnation = createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "base64url"), Buffer.from(envelope.iv, "base64url"));
  wrongIncarnation.setAAD(Buffer.from(`${PROTOCOL_VERSION}\0${SESSION_ID}\0${VIEW_ID}\0wrong\0${DELIVERY_ID}`));
  wrongIncarnation.setAuthTag(combined.subarray(-16));
  assert.throws(() => Buffer.concat([wrongIncarnation.update(combined.subarray(0, -16)), wrongIncarnation.final()]));
});

test("uploader accepts only the strict v2 acknowledgement for its delivery", async () => {
  const valid = {
    version: PROTOCOL_VERSION,
    accepted: true,
    deliveryId: DELIVERY_ID,
    duplicate: false,
  };
  assert.deepEqual(parseUploadAcknowledgement(valid, DELIVERY_ID), valid);
  for (const invalid of [
    { ...valid, version: 1 },
    { ...valid, version: PROTOCOL_VERSION + 1 },
    { ...valid, accepted: "true" },
    { ...valid, deliveryId: SESSION_ID },
    { version: PROTOCOL_VERSION, accepted: true, deliveryId: DELIVERY_ID },
    { ...valid, extra: true },
  ]) {
    assert.equal(parseUploadAcknowledgement(invalid, DELIVERY_ID), null);
  }

  await assert.rejects(
    uploadDelivery("https://relay.example", UPLOAD_TOKEN, { deliveryId: DELIVERY_ID }, {
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({ ...valid, version: 1 }),
      }),
      wait: async () => {},
    }),
    (error) => error?.outcome === "unknown" &&
      error.message === "Relay returned an invalid acknowledgement",
  );
});

test("an invalid success acknowledgement preserves the retry cache", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bundlePath = path.join(temporary, "relay-test.freeform-artifact.json");
  await writeFile(bundlePath, JSON.stringify(BUNDLE));
  let output = "";
  const status = await runDeliveryCli([
    "--relay-url", "https://relay.example",
    "--session-id", SESSION_ID,
    "--credentials-stdin",
    "--view-id", VIEW_ID,
    "--view-incarnation-id", VIEW_INCARNATION_ID,
    bundlePath,
  ], {
    input: Readable.from([`${JSON.stringify({ uploadToken: UPLOAD_TOKEN, encryptionKey: ENCRYPTION_KEY })}\n`]),
    output: { write: (value) => { output += value; } },
    errorOutput: { write: () => {} },
    env: { FREEFORM_RELAY_CACHE_DIR: temporary },
    fetchImpl: async (_url, options) => {
      const delivery = JSON.parse(options.body);
      return {
        ok: true,
        status: 202,
        json: async () => ({
          version: 1,
          accepted: true,
          deliveryId: delivery.deliveryId,
          duplicate: false,
        }),
      };
    },
    wait: async () => {},
  });
  assert.equal(status, 1);
  const result = JSON.parse(output);
  assert.equal(result.outcome, "unknown");
  assert.equal(
    (await stat(path.join(
      temporary,
      "freeform-artifacts",
      "relay-deliveries",
      SESSION_ID,
      `${result.deliveryId}.json`,
    ))).isFile(),
    true,
  );
});

test("thin launcher verifies every uploader module before loading the core", async (t) => {
  const scripts = new URL("../skill/freeform-artifact-builder/scripts/", import.meta.url);
  const launcher = new URL("./deliver.mjs", scripts);
  const intact = await runNode([launcher.pathname, "--help"]);
  assert.equal(intact.status, 0);
  assert.match(intact.stdout, /--view-incarnation-id/);

  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const filename of [
    "deliver.mjs",
    "deliver-core.mjs",
    "delivery-cache.mjs",
    "delivery-input.mjs",
    "delivery-protocol.mjs",
    "delivery-upload.mjs",
  ]) {
    await copyFile(new URL(filename, scripts), path.join(temporary, filename));
  }
  await appendFile(path.join(temporary, "delivery-upload.mjs"), "\n// tampered\n");
  const tampered = await runNode([path.join(temporary, "deliver.mjs"), "--help"]);
  assert.equal(tampered.status, 1);
  assert.equal(tampered.stdout, "");
  assert.match(tampered.stderr, /Delivery core integrity verification failed/);
});

test("handoff pins the CLI and publishes the launcher's exact SHA-256", async () => {
  const handoffSource = await readFile(new URL("../src/canvas/components/AgentHandoffDialog.tsx", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../skill/freeform-artifact-builder/scripts/deliver.mjs", import.meta.url));
  const digest = createHash("sha256").update(launcher).digest("hex");
  assert.match(handoffSource, /SKILLS_CLI_VERSION = "1\.5\.17"/);
  assert.match(handoffSource, /git -C \"\$skill_checkout\" fetch --quiet --depth 1 https:\/\/github\.com\/siriusctrl\/freeform-artifacts\.git \$\{VERIFIED_SKILL_SOURCE_REF\}/);
  assert.match(handoffSource, /rev-parse FETCH_HEAD/);
  assert.match(handoffSource, /npx --yes skills@\$\{SKILLS_CLI_VERSION\} add \"\$skill_checkout\"/);
  assert.doesNotMatch(handoffSource, /SKILL_SOURCE_REF = "__FREEFORM_SKILL_REF__"/);
  assert.match(handoffSource, /SKILL_SOURCE_REF = "[a-f0-9]{40}"/);
  assert.match(handoffSource, /--view-incarnation-id/);
  assert.match(handoffSource, new RegExp(`DELIVER_SCRIPT_SHA256 = "${digest}"`));
});

test("CLI redacts credential-bearing transport errors", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bundlePath = path.join(temporary, "relay-test.freeform-artifact.json");
  await writeFile(bundlePath, JSON.stringify(BUNDLE));
  const input = Readable.from([`${JSON.stringify({ uploadToken: UPLOAD_TOKEN, encryptionKey: ENCRYPTION_KEY })}\n`]);
  let output = "";
  let errorOutput = "";
  const status = await runDeliveryCli([
    "--relay-url", "https://relay.example",
    "--session-id", SESSION_ID,
    "--credentials-stdin",
    "--view-id", VIEW_ID,
    "--view-incarnation-id", VIEW_INCARNATION_ID,
    bundlePath,
  ], {
    input,
    output: { write: (value) => { output += value; } },
    errorOutput: { write: (value) => { errorOutput += value; } },
    env: { FREEFORM_RELAY_CACHE_DIR: temporary },
    fetchImpl: async () => {
      throw new Error(`transport reflected ${UPLOAD_TOKEN} ${ENCRYPTION_KEY}`);
    },
    wait: async () => {},
  });
  assert.equal(status, 1);
  assert.match(output, /"outcome": "unknown"/);
  assert.match(errorOutput, /Delivery outcome is unknown/);
  assert.doesNotMatch(`${output}\n${errorOutput}`, new RegExp(UPLOAD_TOKEN));
  assert.doesNotMatch(`${output}\n${errorOutput}`, new RegExp(ENCRYPTION_KEY));
});

test("accepted delivery reports a safe error when definitive cache unlink is denied", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bundlePath = path.join(temporary, "relay-test.freeform-artifact.json");
  await writeFile(bundlePath, JSON.stringify(BUNDLE));
  const actualFileSystem = {
    chmod,
    link,
    lstat,
    mkdir,
    readFile,
    readdir,
    rm,
    unlink: async (file) => {
      if (file.endsWith(".tmp")) return unlink(file);
      throw Object.assign(new Error("permission denied at a private path"), { code: "EACCES" });
    },
    writeFile,
  };
  let output = "";
  let errorOutput = "";
  const status = await runDeliveryCli([
    "--relay-url", "https://relay.example",
    "--session-id", SESSION_ID,
    "--credentials-stdin",
    "--view-id", VIEW_ID,
    "--view-incarnation-id", VIEW_INCARNATION_ID,
    bundlePath,
  ], {
    input: Readable.from([`${JSON.stringify({ uploadToken: UPLOAD_TOKEN, encryptionKey: ENCRYPTION_KEY })}\n`]),
    output: { write: (value) => { output += value; } },
    errorOutput: { write: (value) => { errorOutput += value; } },
    env: { FREEFORM_RELAY_CACHE_DIR: temporary },
    fileSystem: actualFileSystem,
    fetchImpl: async (_url, options) => {
      const delivery = JSON.parse(options.body);
      return {
        ok: true,
        status: 202,
        json: async () => ({
          version: PROTOCOL_VERSION,
          accepted: true,
          deliveryId: delivery.deliveryId,
          duplicate: false,
        }),
      };
    },
  });
  assert.equal(status, 1);
  assert.match(output, /"accepted": true/);
  assert.match(output, /"cacheCleanup": false/);
  assert.match(errorOutput, /Unable to remove the delivery retry cache after a definitive relay outcome/);
  assert.doesNotMatch(`${output}\n${errorOutput}`, /permission denied|private path/);
  assert.doesNotMatch(`${output}\n${errorOutput}`, new RegExp(UPLOAD_TOKEN));
  assert.doesNotMatch(`${output}\n${errorOutput}`, new RegExp(ENCRYPTION_KEY));
});
