import { useCallback, useEffect, useRef, useState } from "react";
import { hashCapability, randomCapability, randomEncryptionKey } from "./crypto";
import { RELAY_URL } from "./config";
import {
  RELAY_PROTOCOL_VERSION,
  relayCapabilitySchema,
  relaySessionCreatedSchema,
} from "./protocol";
import { decryptRelayDelivery } from "./crypto";
import { RelayConnection, type RelayConnectionRuntime } from "./relayConnection";
import type {
  ActiveRelaySession,
  RelayConnectionStatus,
  RelayDeliveryIdentity,
  RelayDeliveryOutcome,
  RelayInstallResult,
  RelaySessionRequest,
} from "./types";

const relayFetch = window.fetch.bind(window);
const relayWebSocket = window.WebSocket;
const relayConnectionRuntime: RelayConnectionRuntime = {
  WebSocket: relayWebSocket,
  clearTimeout: window.clearTimeout.bind(window),
  decrypt: decryptRelayDelivery,
  now: Date.now,
  setTimeout: window.setTimeout.bind(window),
};
const browserCapabilities = new WeakMap<ActiveRelaySession, string>();
const WEB_LOCKS_REQUIRED_MESSAGE =
  "Build Sessions need this browser's cross-tab locking support. Use file install as the offline fallback.";
const SESSION_REVOCATION_TIMEOUT_MS = 3_000;

async function revokeSessionBestEffort(
  active: ActiveRelaySession,
  browserToken: string,
) {
  const revokeAbort = new AbortController();
  const revokeTimeout = window.setTimeout(
    () => revokeAbort.abort(),
    SESSION_REVOCATION_TIMEOUT_MS,
  );
  try {
    await relayFetch(`${active.endpoint}/v1/sessions/${active.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${browserToken}` },
      signal: revokeAbort.signal,
    });
  } catch {
    // The server alarm remains the final cleanup boundary.
  } finally {
    window.clearTimeout(revokeTimeout);
  }
}

function relayStorageSafetyAvailable() {
  return Boolean(navigator.locks?.request);
}

function sessionCreationFailureMessage(code?: string) {
  if (code === "rate_limited") {
    return "Too many Build Session attempts. Wait a minute, then try again.";
  }
  if (code === "turnstile_unavailable") {
    return "Browser verification is temporarily unavailable. Try again shortly.";
  }
  if (code === "turnstile_rejected" || code === "turnstile_action_mismatch" || code === "turnstile_hostname_mismatch") {
    return "Browser verification was not accepted. Retry verification.";
  }
  if (code === "origin_not_allowed") {
    return "This site is not allowed to open Build Sessions.";
  }
  if (code === "invalid_session" || code === "invalid_json" || code === "body_too_large") {
    return "The Build Session request was invalid. Reload the page and try again.";
  }
  return "Build Sessions are temporarily unavailable. Try again shortly.";
}

function relayErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

export interface ArtifactRelayController {
  completeVerification: (turnstileToken: string) => Promise<void>;
  deliveryOutcome: RelayDeliveryOutcome | null;
  lastMessage: string;
  reportVerificationError: (message: string) => void;
  request: RelaySessionRequest | null;
  requestSession: (request: RelaySessionRequest) => void;
  retrySession: () => void;
  session: ActiveRelaySession | null;
  status: RelayConnectionStatus;
  stopSession: () => Promise<void>;
}

export function useArtifactRelaySession(
  onDelivery: (
    targetViewId: string,
    bundles: unknown[],
    placement: RelaySessionRequest,
    identity: RelayDeliveryIdentity,
  ) => Promise<RelayInstallResult>,
): ArtifactRelayController {
  const [session, setSession] = useState<ActiveRelaySession | null>(null);
  const [request, setRequest] = useState<RelaySessionRequest | null>(null);
  const [status, setStatus] = useState<RelayConnectionStatus>("idle");
  const [lastMessage, setLastMessage] = useState("");
  const [deliveryOutcome, setDeliveryOutcome] = useState<RelayDeliveryOutcome | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionRef = useRef<RelayConnection | null>(null);
  const creationGeneration = useRef(0);
  const creatingGeneration = useRef<number | null>(null);
  const creationAbortControllers = useRef(new Set<AbortController>());
  const activeSessionRef = useRef<ActiveRelaySession | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);

  const invalidateSessionWork = useCallback(() => {
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    connectionRef.current?.stop(1000, "Build Session closed");
    connectionRef.current = null;
  }, []);

  const invalidateCreation = useCallback((abort = true) => {
    creationGeneration.current += 1;
    if (abort) {
      for (const controller of creationAbortControllers.current) controller.abort();
      creationAbortControllers.current.clear();
    }
    creatingGeneration.current = null;
  }, []);

  useEffect(() => () => invalidateCreation(), [invalidateCreation]);

  const expireLocalSession = useCallback(() => {
    invalidateSessionWork();
    activeSessionRef.current = null;
    setSession(null);
    setStatus("expired");
    setLastMessage("Build Session expired");
    setDeliveryOutcome(null);
  }, [invalidateSessionWork]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining <= 0) {
      expireLocalSession();
      return;
    }
    const timer = window.setTimeout(expireLocalSession, remaining);
    return () => window.clearTimeout(timer);
  }, [expireLocalSession, session]);

  useEffect(() => {
    if (!session) return;
    const browserToken = browserCapabilities.get(session);
    if (!browserToken) return;
    const revokeOnPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      invalidateSessionWork();
      activeSessionRef.current = null;
      void relayFetch(`${session.endpoint}/v1/sessions/${session.sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${browserToken}` },
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", revokeOnPageHide);
    return () => window.removeEventListener("pagehide", revokeOnPageHide);
  }, [invalidateSessionWork, session]);

  useEffect(() => {
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return;
    const abortController = sessionAbortRef.current;
    const browserToken = browserCapabilities.get(session);
    if (!abortController || !browserToken) return;
    const connection = new RelayConnection({
      attempt: connectionAttempt,
      browserToken,
      onDelivery,
      parentSignal: abortController.signal,
      runtime: relayConnectionRuntime,
      session,
      events: {
        onDeliveryOutcome: setDeliveryOutcome,
        onExpire: expireLocalSession,
        onMessage: setLastMessage,
        onReconnect: () => setConnectionAttempt((current) => current + 1),
        onSocket: (socket) => {
          socketRef.current = socket;
        },
        onStatus: setStatus,
      },
    });
    connectionRef.current = connection;
    connection.start();
    return () => {
      connection.stop();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [connectionAttempt, expireLocalSession, onDelivery, session]);

  const restartActiveConnection = useCallback((active: ActiveRelaySession) => {
    if (activeSessionRef.current !== active || Date.parse(active.expiresAt) <= Date.now()) return false;
    connectionRef.current?.stop(1000, "User requested reconnect");
    connectionRef.current = null;
    socketRef.current = null;
    if (!sessionAbortRef.current || sessionAbortRef.current.signal.aborted) {
      sessionAbortRef.current = new AbortController();
    }
    setStatus("reconnecting");
    setLastMessage("Reconnecting this browser to the Build Session");
    setConnectionAttempt((current) => current + 1);
    return true;
  }, []);

  const stopSession = useCallback(async () => {
    const active = activeSessionRef.current;
    invalidateCreation();
    invalidateSessionWork();
    activeSessionRef.current = null;
    setSession(null);
    setRequest(null);
    setStatus("idle");
    setLastMessage("");
    setDeliveryOutcome(null);
    if (!active) return;
    const browserToken = browserCapabilities.get(active);
    if (!browserToken) return;
    await revokeSessionBestEffort(active, browserToken);
  }, [invalidateCreation, invalidateSessionWork]);

  const requestSession = useCallback((nextRequest: RelaySessionRequest) => {
    setRequest(nextRequest);
    if (!relayStorageSafetyAvailable()) {
      invalidateCreation();
      setDeliveryOutcome(null);
      setStatus("error");
      setLastMessage(WEB_LOCKS_REQUIRED_MESSAGE);
      return;
    }
    if (
      session &&
      session.targetViewId === nextRequest.targetViewId &&
      session.targetViewIncarnationId === nextRequest.targetViewIncarnationId &&
      Date.parse(session.expiresAt) > Date.now()
    ) {
      if (status === "error" || !connectionRef.current) {
        restartActiveConnection(session);
      } else if (status === "connected" && socketRef.current?.readyState === relayWebSocket.OPEN) {
        setLastMessage("Reusing this view's active Build Session");
      }
      return;
    }
    invalidateCreation(false);
    setDeliveryOutcome(null);
    setStatus("verifying");
    setLastMessage("Verifying this Build Session");
  }, [invalidateCreation, restartActiveConnection, session, status]);

  const completeVerification = useCallback(async (turnstileToken: string) => {
    if (!request) return;
    const generation = creationGeneration.current;
    if (creatingGeneration.current === generation) return;
    const requested = request;
    const creationAbort = new AbortController();
    creationAbortControllers.current.add(creationAbort);
    creatingGeneration.current = generation;
    const timeout = window.setTimeout(() => creationAbort.abort("creation_timeout"), 15_000);
    const creationIsCurrent = () =>
      generation === creationGeneration.current &&
      !creationAbort.signal.aborted;
    setStatus("creating");
    setLastMessage("Opening encrypted Build Session");
    const previous = activeSessionRef.current;
    const browserToken = randomCapability();
    const uploadToken = randomCapability();
    const encryptionKey = randomEncryptionKey();
    try {
      if (!relayStorageSafetyAvailable()) throw new Error(WEB_LOCKS_REQUIRED_MESSAGE);
      if (
        !relayCapabilitySchema.safeParse(browserToken).success ||
        !relayCapabilitySchema.safeParse(uploadToken).success ||
        !relayCapabilitySchema.safeParse(encryptionKey).success
      ) {
        throw new Error("Browser generated invalid Build Session credentials");
      }
      if (previous && (
        previous.targetViewId !== requested.targetViewId ||
        previous.targetViewIncarnationId !== requested.targetViewIncarnationId
      )) {
        const previousBrowserToken = browserCapabilities.get(previous);
        invalidateSessionWork();
        activeSessionRef.current = null;
        setSession(null);
        if (previousBrowserToken) {
          void revokeSessionBestEffort(previous, previousBrowserToken);
        }
      }
      if (!creationIsCurrent()) return;
      const response = await relayFetch(`${RELAY_URL}/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: creationAbort.signal,
        body: JSON.stringify({
          version: RELAY_PROTOCOL_VERSION,
          targetViewId: requested.targetViewId,
          targetViewIncarnationId: requested.targetViewIncarnationId,
          browserTokenHash: await hashCapability(browserToken),
          uploadTokenHash: await hashCapability(uploadToken),
          turnstileToken,
        }),
      });
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new Error(response.ok
          ? "Relay returned an invalid Build Session response"
          : sessionCreationFailureMessage());
      }
      if (!response.ok) throw new Error(sessionCreationFailureMessage(relayErrorCode(value)));
      const parsedBody = relaySessionCreatedSchema.safeParse(value);
      if (!parsedBody.success) throw new Error("Relay returned an invalid Build Session response");
      const body = parsedBody.data;
      if (body.targetViewId !== requested.targetViewId) throw new Error("Relay returned a different target view");
      if (body.targetViewIncarnationId !== requested.targetViewIncarnationId) {
        throw new Error("Relay returned a different target view incarnation");
      }
      const active: ActiveRelaySession = {
        ...requested,
        endpoint: RELAY_URL,
        sessionId: body.sessionId,
        uploadToken,
        encryptionKey,
        expiresAt: body.expiresAt,
      };
      if (!creationIsCurrent()) {
        void revokeSessionBestEffort(active, browserToken);
        return;
      }
      invalidateSessionWork();
      browserCapabilities.set(active, browserToken);
      sessionAbortRef.current = new AbortController();
      activeSessionRef.current = active;
      setConnectionAttempt(0);
      setSession(active);
      setStatus("connecting");
      setLastMessage("Connecting this browser to the Build Session");
    } catch (error) {
      if (generation !== creationGeneration.current) return;
      setStatus("error");
      setLastMessage(creationAbort.signal.aborted
        ? "Build Session creation timed out"
        : error instanceof Error ? error.message : "Unable to start Build Session");
    } finally {
      window.clearTimeout(timeout);
      if (creatingGeneration.current === generation) creatingGeneration.current = null;
      creationAbortControllers.current.delete(creationAbort);
    }
  }, [invalidateSessionWork, request]);

  const reportVerificationError = useCallback((message: string) => {
    setStatus("error");
    setLastMessage(message);
  }, []);

  const retrySession = useCallback(() => {
    if (!relayStorageSafetyAvailable()) {
      setStatus("error");
      setLastMessage(WEB_LOCKS_REQUIRED_MESSAGE);
      return;
    }
    if (session && Date.parse(session.expiresAt) > Date.now()) {
      restartActiveConnection(session);
      return;
    }
    if (!request) return;
    setStatus("verifying");
    setLastMessage("Verifying this Build Session");
  }, [request, restartActiveConnection, session]);

  return {
    completeVerification,
    deliveryOutcome,
    lastMessage,
    reportVerificationError,
    request,
    requestSession,
    retrySession,
    session,
    status,
    stopSession,
  };
}
