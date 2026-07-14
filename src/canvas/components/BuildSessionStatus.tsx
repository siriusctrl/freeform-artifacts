import { ShieldCheck } from "lucide-react";
import { useCallback } from "react";
import { RELAY_TURNSTILE_SITE_KEY } from "../../relay/config";
import { TurnstileGate } from "../../relay/TurnstileGate";
import type { ActiveRelaySession, RelayConnectionStatus } from "../../relay/types";
import type { ArtifactRelayController } from "../../relay/useArtifactRelaySession";
import type { ThemeMode } from "../constants";

interface BuildSessionStatusProps {
  installBusy: boolean;
  relay: ArtifactRelayController;
  session: ActiveRelaySession | null;
  themeMode: ThemeMode;
  viewId: string;
}

function expiryLabel(expiresAt: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(expiresAt));
}

function statusLabel(status: RelayConnectionStatus) {
  if (status === "connected") return "Live delivery ready";
  if (status === "reconnecting") return "Restoring live delivery";
  if (status === "expired") return "Live session expired";
  if (status === "error") return "Live delivery unavailable";
  if (status === "verifying") return "Checking this browser";
  if (status === "creating") return "Opening private delivery";
  if (status === "connecting") return "Connecting live delivery";
  return "File delivery ready";
}

function statusDetail(relay: ArtifactRelayController, installBusy: boolean, targetTitle: string) {
  if (installBusy) return "Installing delivery… Canvas editing resumes after the atomic commit.";
  if (relay.status === "verifying") return "Your agent can start building while the browser check finishes.";
  if (relay.status === "creating") return "Your agent can keep building while the private session opens.";
  if (relay.status === "connecting") return "The private session is open; the browser is joining it now.";
  if (relay.status === "connected") return `${targetTitle} · Ready for encrypted deliveries`;
  if (relay.status === "reconnecting") return "Your agent can keep building; the browser will catch up automatically.";
  if (relay.status === "expired") return "Start a new live session, or install a bundle returned by your agent.";
  if (relay.status === "error") return `${relay.lastMessage || "Automatic delivery could not start"} File install is still available.`;
  return "Generate a bundle now and install it from your agent.";
}

export function BuildSessionStatus({ installBusy, relay, session, themeMode, viewId }: BuildSessionStatusProps) {
  const completeVerification = relay.completeVerification;
  const handleTurnstileToken = useCallback((token: string) => {
    void completeVerification(token);
  }, [completeVerification]);
  const targetTitle = relay.request?.targetViewTitle ?? viewId;
  const verifyingTarget = relay.status === "verifying" && relay.request?.targetViewId === viewId;

  return (
    <section
      className={`relay-session-state relay-${relay.status} ${relay.deliveryOutcome?.kind === "rejected" ? "relay-delivery-rejected" : ""}`}
      data-testid="relay-session-status"
      aria-busy={relay.status === "verifying" || relay.status === "creating" || relay.status === "connecting"}
    >
      <div className="relay-transport-row" role="status" aria-live="polite" aria-atomic="true">
        <span className="relay-status-dot" aria-hidden="true" />
        <div className="relay-transport-copy" data-testid="relay-transport-state">
          <strong>{statusLabel(relay.status)}</strong>
          <span data-testid={installBusy ? "relay-install-progress" : undefined}>
            {statusDetail(relay, installBusy, targetTitle)}
          </span>
        </div>
        {session ? <time dateTime={session.expiresAt}>until {expiryLabel(session.expiresAt)}</time> : null}
      </div>

      {verifyingTarget ? (
        <div className="relay-verification-panel" data-testid="relay-verification-panel">
          <div className="relay-verification-copy">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>Private delivery check</strong>
              <span>A quick Cloudflare check protects the live delivery link. Only delivery waits for it.</span>
            </div>
          </div>
          <TurnstileGate
            siteKey={RELAY_TURNSTILE_SITE_KEY}
            theme={themeMode}
            onError={relay.reportVerificationError}
            onToken={handleTurnstileToken}
          />
        </div>
      ) : null}

      {(relay.status === "error" || relay.status === "expired") && relay.request ? (
        <button type="button" className="relay-retry-action" onClick={relay.retrySession}>
          {relay.status === "expired" ? "Start new live session" : session ? "Retry connection" : "Retry live delivery"}
        </button>
      ) : null}

      {relay.deliveryOutcome ? (
        <div className={`relay-delivery-outcome relay-delivery-${relay.deliveryOutcome.kind}`} data-testid="relay-delivery-outcome">
          <span className="relay-delivery-outcome-label">Last delivery</span>
          <strong>{relay.deliveryOutcome.summary}</strong>
          {relay.deliveryOutcome.detail ? <span>{relay.deliveryOutcome.detail}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
