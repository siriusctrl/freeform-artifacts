import { Check, Copy, PackagePlus, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RELAY_TURNSTILE_SITE_KEY } from "../../relay/config";
import { TurnstileGate } from "../../relay/TurnstileGate";
import type { ArtifactRelayController } from "../../relay/useArtifactRelaySession";

interface AgentHandoffDialogProps {
  open: boolean;
  viewId: string;
  relay: ArtifactRelayController;
  onClose: () => void;
  onInstallBundle: (file: File) => Promise<string | null>;
}

const INSTALL_COMMAND =
  "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder";

function expiryLabel(expiresAt: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(expiresAt));
}

export function AgentHandoffDialog({ open, viewId, relay, onClose, onInstallBundle }: AgentHandoffDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const instructionRef = useRef<HTMLPreElement | null>(null);
  const onCloseRef = useRef(onClose);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revealCapabilities, setRevealCapabilities] = useState(false);
  onCloseRef.current = onClose;
  const session = relay.session?.targetViewId === viewId ? relay.session : null;
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

After installation, follow the Browser Relay workflow. Ask the user what they want to build and clarify the data, visual form, and layout. Generate and validate one or more self-contained .freeform-artifact.json bundles outside the application source tree. Do not create src/artifacts/generated files. Do not modify, commit, or deploy the application repository.

Use renderer: "chart-kit" for ordinary bar, line, or combo charts. Use raw ECharts only for a capability Chart Kit cannot express, and React only for non-chart composition. Do not use imports, network fetches, credentials, timers, or external dependencies inside a bundle.

Deliver every completed selection with the skill's scripts/deliver.mjs command. One command may include multiple bundle paths, and this session-scoped upload capability may be reused for additional deliveries until expiry:

node <installed-freeform-artifact-builder-skill>/scripts/deliver.mjs \\
  --relay-url ${JSON.stringify(session.endpoint)} \\
  --session-id ${JSON.stringify(session.sessionId)} \\
  --credentials-stdin \\
  --view-id ${JSON.stringify(session.targetViewId)} \\
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
      dialogRef.current?.focus();
    });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
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

  if (!open) return null;

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

        <div className={`relay-session-state relay-${relay.status} ${relay.lastMessage.startsWith("Delivery rejected") ? "relay-delivery-rejected" : ""}`} data-testid="relay-session-status" role="status">
          <span className="relay-status-dot" aria-hidden="true" />
          <div>
            <strong>{statusLabel}</strong>
            <span>{relay.request?.targetViewTitle ?? viewId} · {relay.lastMessage || "Session is bound to this view"}</span>
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
        </div>

        <pre
          ref={instructionRef}
          className="agent-instruction"
          data-testid="agent-instruction"
          tabIndex={0}
          aria-label={revealCapabilities ? "Agent instruction with sensitive capabilities visible" : "Agent instruction with sensitive capabilities hidden; Copy instruction includes them"}
        >
          {displayedInstruction}
        </pre>

        <div className={`agent-dialog-feedback ${feedback.startsWith("Install failed") || feedback.startsWith("Copy failed") ? "error" : ""}`}>
          <span role="status" aria-live="polite">{feedback || "Capabilities stay hidden on screen and are included only when you copy."}</span>
          {feedback.startsWith("Copy failed") && !revealCapabilities ? (
            <button type="button" onClick={() => {
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
          <button type="button" className="secondary-action install-bundle-action" data-testid="install-bundle" onClick={() => bundleInputRef.current?.click()}>
            <PackagePlus size={17} />
            <span>Install offline bundle</span>
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
