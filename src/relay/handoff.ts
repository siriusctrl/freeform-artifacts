import type { ActiveRelaySession, RelaySessionRequest } from "./types";

const SKILLS_CLI_VERSION = "1.5.17";
const SKILL_SOURCE_REF = "b68d9e261f3417701afe28e13bff8973cae32754";
const DELIVER_SCRIPT_SHA256 = "4a284fd9597f10a29a4c64f2cc9722e96979841acd38f596f4e885b94935b19e";

type ResolvedSupplyChainValue<Value extends string, Placeholder extends string> =
  Value extends Placeholder ? never : Value;

// Release these values in two stages: publish the skill commit first, then pin
// its immutable ref and launcher digest here. An unresolved production source
// must fail TypeScript validation instead of silently installing from main.
const VERIFIED_SKILL_SOURCE_REF: ResolvedSupplyChainValue<
  typeof SKILL_SOURCE_REF,
  "__FREEFORM_SKILL_REF__"
> = SKILL_SOURCE_REF;
const VERIFIED_DELIVER_SCRIPT_SHA256: ResolvedSupplyChainValue<
  typeof DELIVER_SCRIPT_SHA256,
  "__FREEFORM_DELIVER_SHA256__"
> = DELIVER_SCRIPT_SHA256;

const INSTALL_COMMAND = `(
  set -eu
  skill_checkout="$(mktemp -d)"
  trap 'rm -rf "$skill_checkout"' EXIT
  git -C "$skill_checkout" init --quiet
  git -C "$skill_checkout" fetch --quiet --depth 1 https://github.com/siriusctrl/freeform-artifacts.git ${VERIFIED_SKILL_SOURCE_REF}
  test "$(git -C "$skill_checkout" rev-parse FETCH_HEAD)" = ${JSON.stringify(VERIFIED_SKILL_SOURCE_REF)}
  git -C "$skill_checkout" checkout --quiet --detach FETCH_HEAD
  npx --yes skills@${SKILLS_CLI_VERSION} add "$skill_checkout" --skill freeform-artifact-builder --yes --global
)`;
const VERIFY_DELIVER_COMMAND =
  `node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; const actual = createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'); if (actual !== process.argv[2]) { console.error('Freeform delivery script integrity verification failed'); process.exit(1); }" <installed-freeform-artifact-builder-skill>/scripts/deliver.mjs ${VERIFIED_DELIVER_SCRIPT_SHA256}`;

type HandoffTarget = Pick<
  RelaySessionRequest,
  "targetViewId" | "targetViewIncarnationId" | "targetViewTitle"
>;

const ARTIFACT_RULES = `Generate and validate one or more self-contained .freeform-artifact.json bundles outside the application source tree. Do not create src/artifacts/generated files. Do not modify, commit, or deploy the application repository.

Use renderer: "chart-kit" for ordinary bar, line, or combo charts. Use raw ECharts only for a capability Chart Kit cannot express, and React only for non-chart composition. Do not use imports, network fetches, credentials, timers, or external dependencies inside a bundle.`;

function targetHeader(target: HandoffTarget) {
  const oneLine = (value: string) => JSON.stringify(value).slice(1, -1);
  return `Target Freeform view id: ${oneLine(target.targetViewId)}
Target Freeform view title: ${oneLine(target.targetViewTitle)}
Target Freeform view incarnation id: ${oneLine(target.targetViewIncarnationId)}`;
}

export function createBundleBuildInstruction(target: HandoffTarget) {
  return `Delivery mode: BROWSER_VIEW_BUNDLE
${targetHeader(target)}
This request came from an explicit Build with AI action in an open Freeform browser. Start building immediately; automatic browser delivery is being prepared separately and must not block authoring.

Install the project artifact skill for your agent:
${INSTALL_COMMAND}

After installation, follow the Browser View Bundle workflow. Ask the user what they want to build and clarify the data, visual form, and layout. ${ARTIFACT_RULES}

No live upload capability has been issued. Do not call scripts/deliver.mjs and do not upload the bundles anywhere. Keep the exact completed bundle files. If a later instruction says Delivery mode: BROWSER_RELAY for the same target view and incarnation, reuse and deliver these bundles instead of regenerating them.

When browser access is available, inspect the cards at default and minimum size in light and dark mode. Otherwise return every completed .freeform-artifact.json file to the user so they can install each file with Freeform's Install from agent action. The final report must name the artifact ids, bundle file paths, and target view.`;
}

export function createRelayBuildInstruction(
  session: ActiveRelaySession,
) {
  return `Delivery mode: BROWSER_RELAY
${targetHeader(session)}
This request came from an explicit Build with AI session in an open Freeform browser. The session remains bound to the target view above even if the user navigates elsewhere.

Reuse any completed or in-progress bundles already present in this conversation for this exact target view and incarnation; do not restart discovery or regenerate valid work. If artifact work has not started, ask the user what they want to build and clarify the data, visual form, and layout.

Use the pinned project artifact skill from an earlier build brief if it is already installed. Otherwise install it now:
${INSTALL_COMMAND}

Verify the installed delivery launcher before using it. Stop if this command fails; the verified launcher also checks its dependency-free core before reading credentials:
${VERIFY_DELIVER_COMMAND}

After installation, follow the Browser Relay workflow. ${ARTIFACT_RULES}

Deliver every completed selection with the skill's scripts/deliver.mjs command. One command may include multiple bundle paths, and this session-scoped upload capability may be reused for additional deliveries until expiry:

node <installed-freeform-artifact-builder-skill>/scripts/deliver.mjs \\
  --relay-url ${JSON.stringify(session.endpoint)} \\
  --session-id ${JSON.stringify(session.sessionId)} \\
  --credentials-stdin \\
  --view-id ${JSON.stringify(session.targetViewId)} \\
  --view-incarnation-id ${JSON.stringify(session.targetViewIncarnationId)} \\
  <bundle-one.freeform-artifact.json> [bundle-two.freeform-artifact.json ...]

Launch that command with no secrets in its arguments. Prefer the agent harness's non-TTY, pipe-backed stdin; when only a PTY is available, the script switches it to hidden raw input before reading. Then write this one-line JSON followed by a newline to standard input without logging it:
${JSON.stringify({ uploadToken: session.uploadToken, encryptionKey: session.encryptionKey })}

The delivery script performs local bundle shape checks, encrypts the complete multi-artifact delivery with AES-GCM, creates a non-replayable delivery id, uploads ciphertext, and reports the relay acknowledgement. The browser validates the entire selection before one atomic package-and-view commit; a failed artifact must not leave a partial dashboard.

Inspect the resulting cards at default and minimum size in light and dark mode when browser access is available. The final report must name the delivered artifact ids, the relay delivery id, and target view. Never repeat the upload token or encryption key in output, logs, files, process arguments, or source; the browser capability is never provided. Session expires at ${session.expiresAt}.`;
}

export function redactRelayCapabilities(instruction: string, session: ActiveRelaySession) {
  return instruction
    .replace(session.uploadToken, "<hidden-upload-capability>")
    .replace(session.encryptionKey, "<hidden-encryption-key>");
}
