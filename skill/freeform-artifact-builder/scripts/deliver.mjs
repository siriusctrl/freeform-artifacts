#!/usr/bin/env node

import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERIFIED_MODULE_SHA256 = Object.freeze({
  "deliver-core.mjs": "95a9cba55c1c1e74183dcae9ed2f5ddc3cc14e5750c3e2e8735bf766e267f186",
  "delivery-cache.mjs": "fad422dcf7c5f8fa04cb5313de7552a034d3d90ed7a89c9f2fbe339824ed4f8a",
  "delivery-input.mjs": "14895a719dc82522f92b0d12ae66c6861eb9cbb2e505849b5932aba12689a050",
  "delivery-protocol.mjs": "cc3ee37c2a90a30bd62f5e42892ce23cb1f93cdc37528b5515028fdcb4638887",
  "delivery-upload.mjs": "ca87ed156684f10cb624031a12746eb227b0f01ba39c4b0a4167d4acfa50bb5d",
});

async function loadVerifiedCore() {
  for (const [filename, expectedDigest] of Object.entries(VERIFIED_MODULE_SHA256)) {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
      throw new Error("Delivery core integrity metadata is not configured");
    }
    const source = await readFile(new URL(filename, import.meta.url));
    const actual = createHash("sha256").update(source).digest();
    const expected = Buffer.from(expectedDigest, "hex");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new Error("Delivery core integrity verification failed");
    }
  }
  return import(new URL("./deliver-core.mjs", import.meta.url).href);
}

try {
  const { runDeliveryCli } = await loadVerifiedCore();
  process.exitCode = await runDeliveryCli();
} catch (error) {
  const message = error instanceof Error ? error.message : "Delivery launcher failed";
  process.stderr.write(`Delivery failed: ${message}\n`);
  process.exitCode = 1;
}
