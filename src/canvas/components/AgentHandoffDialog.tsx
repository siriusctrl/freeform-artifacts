import { Check, Copy, PackagePlus, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RELAY_TURNSTILE_SITE_KEY } from "../../relay/config";
import { TurnstileGate } from "../../relay/TurnstileGate";
import type { ArtifactRelayController } from "../../relay/useArtifactRelaySession";

interface AgentHandoffDialogProps {
  installBusy: boolean;
  open: boolean;
  viewId: string;
  relay: ArtifactRelayController;
  onClose: () => void;
  onOpen: () => void;
  onInstallBundle: (file: File) => Promise<string | null>;
}

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

function expiryLabel(expiresAt: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(expiresAt));
}

export function AgentHandoffDialog({ installBusy, open, viewId, relay, onClose, onOpen, onInstallBundle }: AgentHandoffDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const handoffDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const instructionRef = useRef<HTMLPreElement | null>(null);
  const onCloseRef = useRef(onClose);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revealCapabilities, setRevealCapabilities] = useState(false);
  onCloseRef.current = onClose;
  const activeSession = relay.session;
  const session = activeSession?.targetViewId === relay.request?.targetViewId &&
    activeSession?.targetViewIncarnationId === relay.request?.targetViewIncarnationId
    ? activeSession
    : null;
  const copiedCurrentInstruction = copied && Boolean(session);
  const completeVerification = relay.completeVerification;
  const handleTurnstileToken = useCallback((token: string) => {
    void completeVerification(token);
  }, [completeVerification]);
  const instruction = useMemo(() => session ? `Delivery mode: BROWSER_RELAY
Target Freeform view id: ${session.targetViewId}
Target Freeform view title: ${session.targetViewTitle}
This request came from an explicit Build with AI session in an open Freeform browser. The session remains bound to the target view above even if the user navigates elsewhere.

Install the project artifact skill for your agent:
${INSTALL_COMMAND}

Verify the installed delivery launcher before using it. Stop if this command fails; the verified launcher also checks its dependency-free core before reading credentials:
${VERIFY_DELIVER_COMMAND}

After installation, follow the Browser Relay workflow. Ask the user what they want to build and clarify the data, visual form, and layout. Generate and validate one or more self-contained .freeform-artifact.json bundles outside the application source tree. Do not create src/artifacts/generated files. Do not modify, commit, or deploy the application repository.

Use renderer: "chart-kit" for ordinary bar, line, or combo charts. Use raw ECharts only for a capability Chart Kit cannot express, and React only for non-chart composition. Do not use imports, network fetches, credentials, timers, or external dependencies inside a bundle.

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

Inspect the resulting cards at default and minimum size in light and dark mode when browser access is available. The final report must name the delivered artifact ids, the relay delivery id, and target view. Never repeat the upload token or encryption key in output, logs, files, process arguments, or source; the browser capability is never provided. Session expires at ${session.expiresAt}.` : relay.status === "expired"
    ? "This Build Session expired. Start a new session to receive more deliveries; the offline bundle installer remains available below."
    : relay.status === "error"
      ? "The secure Build Session needs attention. Retry below, or use the offline bundle installer."
      : relay.status === "idle"
        ? "No Build Session is active. Close this dialog and choose Build with AI to start one."
        : "Secure Build Session is being prepared. The offline bundle installer remains available below.", [relay.status, session]);
  const displayedInstruction = useMemo(() => {
    if (!session || revealCapabilities) return instruction;
    return instruction
      .replace(session.uploadToken, "<hidden-upload-capability>")
      .replace(session.encryptionKey, "<hidden-encryption-key>");
  }, [instruction, revealCapabilities, session]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCopied(false);
    setFeedback("");
    setRevealCapabilities(false);
    window.requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), summary, input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      );
      (firstControl ?? dialogRef.current)?.focus();
    });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), summary, input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const focusIsOutsideDialog = !dialogRef.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || focusIsOutsideDialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current || focusIsOutsideDialog)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (relay.status === "expired" || relay.status === "idle") {
      setRevealCapabilities(false);
      setCopied(false);
      setFeedback("");
    }
  }, [relay.status]);

  async function copyInstruction() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      setFeedback("Instruction copied.");
    } catch {
      setCopied(false);
      setFeedback("Copy failed. You can explicitly reveal the capabilities for manual copy.");
    }
  }

  const statusLabel = relay.status === "connected" ? "Relay connected" :
    relay.status === "reconnecting" ? "Reconnecting" :
      relay.status === "expired" ? "Expired" :
        relay.status === "error" ? "Needs attention" : "Opening session";

  if (!open) {
    if (!activeSession) return null;
    const compactMessage = installBusy
      ? "Installing delivery…"
      : relay.deliveryOutcome?.summary ?? `${statusLabel} · until ${expiryLabel(activeSession.expiresAt)}`;
    const openLabel = relay.deliveryOutcome?.kind === "rejected" ? "Open details" : "Open";
    return (
      <aside
        className={`relay-session-indicator relay-${relay.status} ${relay.deliveryOutcome ? `relay-delivery-${relay.deliveryOutcome.kind}` : ""}`}
        data-testid="relay-session-indicator"
        aria-label="Active Build Session"
      >
        <span className="relay-status-dot" aria-hidden="true" />
        <div className="relay-session-indicator-copy" role="status" aria-live="polite" aria-atomic="true">
          <strong>{activeSession.targetViewTitle}</strong>
          <span data-testid={installBusy ? "relay-install-progress" : undefined}>
            {compactMessage}
          </span>
        </div>
        <button type="button" className="relay-indicator-action" data-testid="relay-session-reopen" onClick={onOpen}>{openLabel}</button>
        <button type="button" className="relay-indicator-action relay-indicator-end" onClick={() => { void relay.stopSession(); }}>End</button>
      </aside>
    );
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={dialogRef} className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title" tabIndex={-1}>
        <header className="agent-dialog-header">
          <div className="agent-dialog-title">
            <Sparkles size={20} />
            <div>
              <h2 id="agent-dialog-title">Build with AI</h2>
              <p>One private session can receive several encrypted deliveries.</p>
            </div>
          </div>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className={`relay-session-state relay-${relay.status} ${relay.deliveryOutcome?.kind === "rejected" ? "relay-delivery-rejected" : ""}`} data-testid="relay-session-status" role="status">
          <span className="relay-status-dot" aria-hidden="true" />
          <div data-testid="relay-transport-state">
            <strong>{statusLabel}</strong>
            <span data-testid={installBusy ? "relay-install-progress" : undefined}>
              {installBusy
                ? "Installing delivery… Canvas editing resumes after the atomic commit."
                : `${relay.request?.targetViewTitle ?? viewId} · ${relay.lastMessage || "Session is bound to this view"}`}
            </span>
          </div>
          {session ? <time dateTime={session.expiresAt}>until {expiryLabel(session.expiresAt)}</time> : null}
          {relay.status === "verifying" && relay.request?.targetViewId === viewId ? (
            <TurnstileGate
              siteKey={RELAY_TURNSTILE_SITE_KEY}
              onError={relay.reportVerificationError}
              onToken={handleTurnstileToken}
            />
          ) : null}
          {(relay.status === "error" || relay.status === "expired") && relay.request ? (
            <button type="button" className="relay-retry-action" onClick={relay.retrySession}>
              {relay.status === "expired" ? "Start new session" : session ? "Retry connection" : "Retry verification"}
            </button>
          ) : null}
          {relay.deliveryOutcome ? (
            <div className={`relay-delivery-outcome relay-delivery-${relay.deliveryOutcome.kind}`} data-testid="relay-delivery-outcome">
              <strong>{relay.deliveryOutcome.summary}</strong>
              {relay.deliveryOutcome.detail ? <span>{relay.deliveryOutcome.detail}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="agent-handoff-content">
          <section className="agent-handoff-summary" aria-labelledby="agent-handoff-summary-title">
            <h3 id="agent-handoff-summary-title">Send the session to your agent</h3>
            <ol>
              <li><strong>Copy the instruction</strong><span>Paste it into Codex or Claude.</span></li>
              <li><strong>Describe what to build</strong><span>Keep this tab open; completed cards arrive here.</span></li>
            </ol>
          </section>
          <details ref={handoffDetailsRef} className="agent-handoff-details">
            <summary>Review full agent handoff</summary>
            <pre
              ref={instructionRef}
              className="agent-instruction"
              data-testid="agent-instruction"
              tabIndex={0}
              aria-label={revealCapabilities ? "Agent instruction with sensitive capabilities visible" : "Agent instruction with sensitive capabilities hidden; Copy instruction includes them"}
            >
              {displayedInstruction}
            </pre>
          </details>
        </div>

        <div className={`agent-dialog-feedback ${feedback.startsWith("Install failed") || feedback.startsWith("Copy failed") ? "error" : ""}`}>
          <span role="status" aria-live="polite">{feedback || "Capabilities stay hidden on screen and are included only when you copy."}</span>
          {feedback.startsWith("Copy failed") && !revealCapabilities ? (
            <button type="button" onClick={() => {
              if (handoffDetailsRef.current) handoffDetailsRef.current.open = true;
              setRevealCapabilities(true);
              setFeedback("Capabilities are visible for manual copy. Hide them before recording or sharing the screen.");
              window.requestAnimationFrame(() => instructionRef.current?.focus());
            }}>
              Reveal for manual copy
            </button>
          ) : null}
          {revealCapabilities ? (
            <button type="button" onClick={() => setRevealCapabilities(false)}>Hide capabilities</button>
          ) : null}
        </div>

        <footer className="agent-dialog-actions">
          <input
            ref={bundleInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            disabled={installBusy}
            tabIndex={-1}
            data-testid="artifact-bundle-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                setFeedback(`Checking ${file.name}…`);
                void onInstallBundle(file).then((error) => {
                  if (error) setFeedback(`${error} Nothing was installed in ${relay.request?.targetViewTitle ?? viewId}.`);
                });
              }
              event.currentTarget.value = "";
            }}
          />
          <button type="button" className="secondary-action install-bundle-action" data-testid="install-bundle" disabled={installBusy} onClick={() => bundleInputRef.current?.click()}>
            <PackagePlus size={17} />
            <span>{installBusy ? "Installing bundle…" : "Install offline bundle"}</span>
          </button>
          {session ? (
            <button type="button" className="secondary-action relay-end-action" onClick={() => { void relay.stopSession().finally(onClose); }}>
              End session
            </button>
          ) : null}
          <button type="button" className="secondary-action" onClick={onClose}>
            Close
          </button>
          <button
            ref={copyButtonRef}
            type="button"
            className="primary-action dialog-primary"
            data-testid="copy-agent-instruction"
            disabled={!session}
            onClick={copyInstruction}
          >
            {copiedCurrentInstruction ? <Check size={18} /> : <Copy size={18} />}
            <span>{copiedCurrentInstruction ? "Copied" : "Copy instruction"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
