import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function proofArtifactBundle(
  artifactId = "agent-capacity-card",
  nodeTitle = "Agent Capacity",
  chartTitle = "Installed directly into this view",
  artifactTitle = "Agent Capacity",
) {
  return {
    version: 1,
    artifactId,
    moduleSource: `export const artifact = {
      id: ${JSON.stringify(artifactId)}, renderer: "chart-kit",
      title: ${JSON.stringify(artifactTitle)}, version: "1.0.0", defaultSize: { width: 480, height: 300 },
      buildChart: ({ data }) => ({
        kind: "cartesian", title: data.title,
        categories: data.points.map((point) => point.label),
        series: [{ id: "capacity", name: "Capacity", type: "bar", values: data.points.map((point) => point.value) }],
      }),
    };`,
    node: {
      title: nodeTitle,
      data: { title: chartTitle, points: [{ label: "North", value: 34 }, { label: "South", value: 47 }] },
      config: {},
    },
  };
}

export function brokenProofArtifactBundle() {
  return {
    version: 1,
    artifactId: "broken-proof-card",
    moduleSource: `export const artifact = {
      id: "broken-proof-card", renderer: "chart-kit", title: "Broken proof card",
      version: "1.0.0", defaultSize: { width: 420, height: 260 },
      buildChart: () => ({ kind: "cartesian", categories: ["North", "South"],
        series: [{ id: "capacity", name: "Capacity", type: "bar", values: [34] }] }),
    };`,
    node: { title: "Broken proof card", data: {}, config: {} },
  };
}

export function parseRelayHandoff(handoff) {
  const option = (name) => handoff.match(new RegExp(`--${name}\\s+"([^"]+)"`))?.[1];
  const credentialsLine = handoff.split("\n").find((line) => line.startsWith('{"uploadToken"'));
  const credentials = credentialsLine ? JSON.parse(credentialsLine) : {};
  return {
    endpoint: option("relay-url"),
    sessionId: option("session-id"),
    uploadToken: credentials.uploadToken,
    encryptionKey: credentials.encryptionKey,
    targetViewId: option("view-id"),
    targetViewIncarnationId: option("view-incarnation-id"),
  };
}

export function startProofServers({ root, host, port, relayPort, appUrl, relayUrl }) {
  const relayServer = spawn("npx", [
    "wrangler", "dev", "--config", "relay/wrangler.jsonc", "--local",
    "--ip", host, "--port", String(relayPort), "--var", "ENVIRONMENT:development",
    "--var", "RELAY_ROUTING_SECRET:development-only-relay-routing-secret-0001",
    "--var", `ALLOWED_ORIGINS:${appUrl}`,
  ], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BROWSER: "none" },
  });
  const appServer = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port), "--strictPort"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_RELAY_URL: relayUrl,
      VITE_RELAY_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  });
  return { appServer, relayServer };
}

export function createRelayDeliveryHelpers({ root, outputDir }) {
  const deliveryScript = path.join(root, "skill/freeform-artifact-builder/scripts/deliver.mjs");
  const relayCacheDir = path.join(outputDir, "relay-cache");

  function prepareDelivery(session, bundles, label) {
    const bundlePaths = bundles.map((bundle, index) => {
      const bundlePath = path.join(outputDir, `${label}-${index}.freeform-artifact.json`);
      writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      return bundlePath;
    });
    const args = [
      deliveryScript,
      "--relay-url", session.endpoint,
      "--session-id", session.sessionId,
      "--credentials-stdin",
      "--view-id", session.targetViewId,
      "--view-incarnation-id", session.targetViewIncarnationId,
      ...bundlePaths,
    ];
    const input = `${JSON.stringify({ uploadToken: session.uploadToken, encryptionKey: session.encryptionKey })}\n`;
    const env = { ...process.env, FREEFORM_RELAY_CACHE_DIR: relayCacheDir };
    return { args, input, env };
  }

  function deliverProofBundles(session, bundles, label) {
    const { args, input, env } = prepareDelivery(session, bundles, label);
    const delivery = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      input,
      env,
    });
    if (delivery.status !== 0) {
      throw new Error(`Relay delivery script failed: ${delivery.stderr || "unknown error"}`);
    }
    return JSON.parse(delivery.stdout);
  }

  function deliverProofBundlesAsync(session, bundles, label) {
    const { args, input, env } = prepareDelivery(session, bundles, label);
    return new Promise((resolve, reject) => {
      const delivery = spawn(process.execPath, args, {
        cwd: root,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      delivery.stdout.setEncoding("utf8");
      delivery.stderr.setEncoding("utf8");
      delivery.stdout.on("data", (chunk) => { stdout += chunk; });
      delivery.stderr.on("data", (chunk) => { stderr += chunk; });
      delivery.on("error", reject);
      delivery.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Relay delivery script failed: ${stderr || `exit ${code}`}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });
      delivery.stdin.end(input);
    });
  }

  return { deliverProofBundles, deliverProofBundlesAsync };
}
