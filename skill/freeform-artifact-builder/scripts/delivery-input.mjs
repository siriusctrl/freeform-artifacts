import { StringDecoder } from "node:string_decoder";

const MAX_CREDENTIAL_BYTES = 4_096;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function fail(message) {
  throw new Error(message);
}

export function usage() {
  return `Usage:
  node deliver.mjs \\
    --relay-url <https://relay.example> \\
    --session-id <uuid> \\
    --credentials-stdin \\
    --view-id <target view id> \\
    --view-incarnation-id <target view incarnation id> \\
    [--delivery-id <uuid>] \\
    <one.freeform-artifact.json> [two.freeform-artifact.json ...]`;
}

export function parseArguments(values) {
  const options = {};
  const bundlePaths = [];
  const named = new Set([
    "--relay-url",
    "--session-id",
    "--view-id",
    "--view-incarnation-id",
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

export function consumeHiddenTtyText(state, text, maximumBytes = MAX_CREDENTIAL_BYTES) {
  const next = { ...state };
  for (const character of text) {
    if (next.complete) break;
    if (character === "\r" || character === "\n" || character === "\u0004") {
      next.complete = true;
      break;
    }
    if (character === "\u0003") {
      next.complete = true;
      next.error = new Error("Credential input cancelled");
      break;
    }
    if (character === "\u007f" || character === "\b") {
      const characters = Array.from(next.source);
      const removed = characters.pop();
      if (removed !== undefined) {
        next.source = characters.join("");
        next.byteLength -= Buffer.byteLength(removed);
      }
      continue;
    }
    const byteLength = Buffer.byteLength(character);
    if (next.byteLength + byteLength > maximumBytes) {
      next.complete = true;
      next.error = new Error("Credential input is too large");
      break;
    }
    next.source += character;
    next.byteLength += byteLength;
  }
  return next;
}

export async function readHiddenTtyLine({ input, errorOutput }) {
  if (typeof input.setRawMode !== "function") {
    fail("This TTY cannot disable input echo; use pipe-backed stdin through the agent harness");
  }
  const wasRaw = Boolean(input.isRaw);
  const decoder = new StringDecoder("utf8");
  errorOutput.write("Credential JSON (input hidden): ");
  return new Promise((resolve, reject) => {
    let state = { source: "", byteLength: 0, complete: false, error: null };
    let settled = false;
    const restore = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.setRawMode(wasRaw);
      input.pause();
      errorOutput.write("\n");
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      restore();
      if (error) reject(error);
      else resolve(state.source);
    };
    const onData = (chunk) => {
      state = consumeHiddenTtyText(state, decoder.write(Buffer.from(chunk)));
      if (state.complete) finish(state.error);
    };
    const onEnd = () => {
      state = consumeHiddenTtyText(state, decoder.end());
      finish(state.error);
    };
    const onError = () => finish(new Error("Credential input failed"));
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
  });
}

export function parseCredentials(source) {
  let value;
  try {
    value = JSON.parse(source.trim());
  } catch {
    fail("Credential input must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Credential input must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "encryptionKey,uploadToken") {
    fail("Credential input must contain only uploadToken and encryptionKey");
  }
  if (!CAPABILITY_PATTERN.test(value.uploadToken)) fail("Upload token is invalid");
  if (!CAPABILITY_PATTERN.test(value.encryptionKey)) fail("Encryption key is invalid");
  return { uploadToken: value.uploadToken, encryptionKey: value.encryptionKey };
}

export async function readCredentialsFromStdin(input, errorOutput) {
  if (input.isTTY) return parseCredentials(await readHiddenTtyLine({ input, errorOutput }));
  let source = "";
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_CREDENTIAL_BYTES) fail("Credential input is too large");
    source += bytes.toString("utf8");
    const newline = source.indexOf("\n");
    if (newline >= 0) {
      source = source.slice(0, newline);
      break;
    }
  }
  return parseCredentials(source);
}
