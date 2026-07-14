import { Check, Copy, FileUp, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBundleBuildInstruction,
  createRelayBuildInstruction,
  redactRelayCapabilities,
} from "../../relay/handoff";
import type { ActiveRelaySession } from "../../relay/types";
import type { ArtifactRelayController } from "../../relay/useArtifactRelaySession";
import type { ThemeMode } from "../constants";
import { BuildSessionStatus } from "./BuildSessionStatus";

interface AgentHandoffDialogProps {
  installBusy: boolean;
  open: boolean;
  themeMode: ThemeMode;
  viewId: string;
  viewIncarnationId: string;
  viewTitle: string;
  relay: ArtifactRelayController;
  onClose: () => void;
  onOpen: () => void;
  onOpenView: (viewId: string) => void;
  onInstallBundle: (
    file: File,
    target: { viewId: string; viewIncarnationId: string },
  ) => Promise<string | null>;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "details > summary",
  "input:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1']):not([data-focus-sentinel])",
].join(",");

function expiryLabel(expiresAt: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(expiresAt));
}

function compactStatusLabel(status: ArtifactRelayController["status"]) {
  if (status === "connected") return "Live delivery ready";
  if (status === "reconnecting") return "Restoring live delivery";
  if (status === "error") return "Live delivery needs attention";
  return "Connecting live delivery";
}

function visibleFocusableElements(dialog: HTMLElement | null) {
  if (!dialog) return [];
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0);
}

export function AgentHandoffDialog({
  installBusy,
  open,
  themeMode,
  viewId,
  viewIncarnationId,
  viewTitle,
  relay,
  onClose,
  onOpen,
  onOpenView,
  onInstallBundle,
}: AgentHandoffDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const handoffDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const instructionRef = useRef<HTMLPreElement | null>(null);
  const closeDialogRef = useRef<() => void>(() => undefined);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionRef = useRef<ActiveRelaySession | null>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const copyAttemptRef = useRef(0);
  const instructionFingerprintRef = useRef("");
  const [copiedFingerprint, setCopiedFingerprint] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [installedOffViewTarget, setInstalledOffViewTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [revealCapabilities, setRevealCapabilities] = useState(false);
  const [startedWithBundle, setStartedWithBundle] = useState(false);

  const target = useMemo(() => {
    const request = relay.request;
    if (request) return request;
    return {
      targetViewId: viewId,
      targetViewIncarnationId: viewIncarnationId,
      targetViewTitle: viewTitle,
    };
  }, [relay.request, viewId, viewIncarnationId, viewTitle]);
  const activeSession = relay.session;
  const session = activeSession?.targetViewId === target.targetViewId &&
    activeSession.targetViewIncarnationId === target.targetViewIncarnationId
    ? activeSession
    : null;
  activeSessionRef.current = session;

  const instruction = useMemo(() => session
    ? createRelayBuildInstruction(session)
    : createBundleBuildInstruction(target), [session, target]);
  const displayedInstruction = useMemo(() => {
    if (!session || revealCapabilities) return instruction;
    return redactRelayCapabilities(instruction, session);
  }, [instruction, revealCapabilities, session]);
  const instructionFingerprint = session
    ? `relay:${session.sessionId}`
    : `bundle:${target.targetViewId}:${target.targetViewIncarnationId}`;
  instructionFingerprintRef.current = instructionFingerprint;
  const copiedCurrentInstruction = copiedFingerprint === instructionFingerprint;

  const closeDialog = useCallback(() => {
    const keepActiveSession = Boolean(activeSessionRef.current);
    copyAttemptRef.current += 1;
    setCopying(false);
    onClose();
    if (!keepActiveSession) void relay.stopSession();
  }, [onClose, relay.stopSession]);
  closeDialogRef.current = closeDialog;

  const focusFirst = useCallback(() => {
    (visibleFocusableElements(dialogRef.current)[0] ?? dialogRef.current)?.focus();
  }, []);
  const focusLast = useCallback(() => {
    const focusable = visibleFocusableElements(dialogRef.current);
    (focusable.at(-1) ?? dialogRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setCopiedFingerprint(null);
    setFeedback("");
    setInstalledOffViewTarget(null);
    setRevealCapabilities(false);
    previousSessionIdRef.current = session?.sessionId ?? null;
    window.requestAnimationFrame(focusFirst);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialogRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusFirst, open]);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = session?.sessionId ?? null;
    if (open && startedWithBundle && session && previousSessionId !== session.sessionId) {
      setCopiedFingerprint(null);
      setFeedback("Live delivery is ready. Copy the delivery step into the same agent conversation, or install the returned bundle file.");
    }
    if (!session) setRevealCapabilities(false);
  }, [open, session, startedWithBundle]);

  async function copyInstruction() {
    if (copying) return;
    const attempt = ++copyAttemptRef.current;
    const copiedSession = Boolean(session);
    const copiedStartedWithBundle = startedWithBundle;
    const fingerprint = instructionFingerprint;
    setCopying(true);
    setCopiedFingerprint(null);
    try {
      await navigator.clipboard.writeText(instruction);
      if (attempt !== copyAttemptRef.current) return;
      setCopying(false);
      if (instructionFingerprintRef.current !== fingerprint) {
        setFeedback("The build handoff changed while copying. Copy the current step again.");
        return;
      }
      setCopiedFingerprint(fingerprint);
      if (copiedSession) {
        setFeedback(copiedStartedWithBundle
          ? "Live delivery step copied. Paste it into the same agent conversation; completed bundles do not need to be rebuilt."
          : "Instruction copied. Paste it into your agent to build and deliver cards here.");
      } else {
        setStartedWithBundle(true);
        setFeedback("Build brief copied. Your agent can start now; use live delivery when it appears, or install the returned bundle file.");
      }
    } catch {
      if (attempt !== copyAttemptRef.current) return;
      setCopying(false);
      setCopiedFingerprint(null);
      setFeedback(session
        ? "Copy failed. You can explicitly reveal the private capabilities for manual copy."
        : "Copy failed. Open the full build brief below and copy it manually.");
      if (!session && handoffDetailsRef.current) handoffDetailsRef.current.open = true;
    }
  }

  if (!open) {
    if (!activeSession) return null;
    const statusLabel = compactStatusLabel(relay.status);
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
          <span data-testid={installBusy ? "relay-install-progress" : undefined}>{compactMessage}</span>
        </div>
        <button type="button" className="relay-indicator-action" data-testid="relay-session-reopen" onClick={onOpen}>{openLabel}</button>
        <button type="button" className="relay-indicator-action relay-indicator-end" onClick={() => { void relay.stopSession(); }}>End</button>
      </aside>
    );
  }

  const primaryLabel = copiedCurrentInstruction
    ? "Copied"
    : session
      ? startedWithBundle ? "Copy live delivery" : "Copy instruction"
      : "Copy build brief";
  const feedbackFallback = session
    ? "Private capabilities stay hidden on screen and are included only when you copy."
    : "This brief has no relay capability. Automatic delivery connects separately.";

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <section ref={dialogRef} className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title" tabIndex={-1}>
        <span className="focus-sentinel" data-focus-sentinel tabIndex={0} onFocus={focusLast} />
        <header className="agent-dialog-header">
          <div className="agent-dialog-title">
            <Sparkles size={20} />
            <div>
              <h2 id="agent-dialog-title">Build with AI</h2>
              <p>Start creating now. Automatic delivery connects in the background.</p>
            </div>
          </div>
          <button type="button" className="icon-button" title="Close" onClick={closeDialog}>
            <X size={19} />
          </button>
        </header>

        <div className="agent-dialog-scroll-region" data-testid="agent-dialog-scroll-region">
          <BuildSessionStatus
            installBusy={installBusy}
            relay={relay}
            session={session}
            themeMode={themeMode}
            viewId={target.targetViewId}
          />

          <div className="agent-handoff-content">
          <section className="agent-handoff-summary" aria-labelledby="agent-handoff-summary-title">
            <h3 id="agent-handoff-summary-title">Start with your agent</h3>
            <ol>
              <li>
                <strong>{session ? startedWithBundle ? "Add live delivery" : "Copy the instruction" : "Copy the build brief"}</strong>
                <span>{session ? "Paste it into Codex or Claude." : "Your agent can generate the bundle while delivery connects."}</span>
              </li>
              <li>
                <strong>Describe what to build</strong>
                <span>{session ? "Completed cards arrive here automatically." : "Use live delivery when ready, or bring the bundle file back."}</span>
              </li>
            </ol>
          </section>

          <section className="agent-file-fallback" aria-labelledby="agent-file-fallback-title">
            <FileUp size={18} aria-hidden="true" />
            <div>
              <strong id="agent-file-fallback-title">Install from agent</strong>
              <span>If automatic delivery is not ready, install each returned .freeform-artifact.json file into {target.targetViewTitle}.</span>
            </div>
            <input
              ref={bundleInputRef}
              hidden
              type="file"
              accept="application/json,.json"
              disabled={installBusy}
              tabIndex={-1}
              data-testid="artifact-bundle-file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  setInstalledOffViewTarget(null);
                  setFeedback(`Checking ${file.name}…`);
                  void onInstallBundle(file, {
                    viewId: target.targetViewId,
                    viewIncarnationId: target.targetViewIncarnationId,
                  }).then((error) => {
                    if (error) {
                      setFeedback(`${error} Nothing was installed in ${target.targetViewTitle}.`);
                    } else {
                      if (target.targetViewId !== viewId) {
                        setInstalledOffViewTarget({
                          id: target.targetViewId,
                          title: target.targetViewTitle,
                        });
                        setFeedback(`Installed ${file.name} into ${target.targetViewTitle}.`);
                      }
                      if (!activeSessionRef.current) void relay.stopSession();
                    }
                  });
                }
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="secondary-action install-bundle-action"
              data-testid="install-bundle"
              disabled={installBusy}
              onClick={() => bundleInputRef.current?.click()}
            >
              <span>{installBusy ? "Installing…" : "Choose bundle file"}</span>
            </button>
          </section>

          <details ref={handoffDetailsRef} className="agent-handoff-details">
            <summary>{session ? "Review full agent handoff" : "Review full build brief"}</summary>
            <pre
              ref={instructionRef}
              className="agent-instruction"
              data-testid="agent-instruction"
              tabIndex={0}
              aria-label={session
                ? revealCapabilities
                  ? "Agent instruction with sensitive capabilities visible"
                  : "Agent instruction with sensitive capabilities hidden; copy includes them"
                : "Agent build brief without relay capabilities"}
            >
              {displayedInstruction}
            </pre>
          </details>
          </div>
        </div>

        <div className={`agent-dialog-feedback ${feedback.startsWith("Install failed") || feedback.startsWith("Copy failed") ? "error" : ""}`}>
          <span role="status" aria-live="polite">{feedback || feedbackFallback}</span>
          {feedback.startsWith("Copy failed") && session && !revealCapabilities ? (
            <button type="button" onClick={() => {
              if (handoffDetailsRef.current) handoffDetailsRef.current.open = true;
              setRevealCapabilities(true);
              setFeedback("Private capabilities are visible for manual copy. Hide them before recording or sharing the screen.");
              window.requestAnimationFrame(() => instructionRef.current?.focus());
            }}>
              Reveal for manual copy
            </button>
          ) : null}
          {revealCapabilities ? (
            <button type="button" onClick={() => setRevealCapabilities(false)}>Hide capabilities</button>
          ) : null}
          {installedOffViewTarget ? (
            <button type="button" data-testid="open-installed-view" onClick={() => {
              const targetViewId = installedOffViewTarget.id;
              closeDialog();
              onOpenView(targetViewId);
            }}>
              Open {installedOffViewTarget.title}
            </button>
          ) : null}
        </div>

        <footer className="agent-dialog-actions">
          {session ? (
            <button type="button" className="secondary-action relay-end-action" onClick={() => {
              copyAttemptRef.current += 1;
              setCopying(false);
              setStartedWithBundle(false);
              onClose();
              void relay.stopSession();
            }}>
              End session
            </button>
          ) : null}
          <button type="button" className="secondary-action" onClick={closeDialog}>Close</button>
          <button
            type="button"
            className="primary-action dialog-primary"
            data-testid="copy-agent-instruction"
            onClick={copyInstruction}
            disabled={copying}
          >
            {copiedCurrentInstruction ? <Check size={18} /> : <Copy size={18} />}
            <span>{copying ? "Copying…" : primaryLabel}</span>
          </button>
        </footer>
        <span className="focus-sentinel" data-focus-sentinel tabIndex={0} onFocus={focusFirst} />
      </section>
    </div>
  );
}
