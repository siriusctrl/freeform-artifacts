import { useCallback, useEffect, useRef, useState } from "react";
import { RelayDeliveryRejectedError } from "./installDelivery";
import { decryptRelayDelivery, hashCapability, randomCapability, randomEncryptionKey } from "./crypto";
import { RELAY_URL } from "./config";
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_WEBSOCKET_PROTOCOL,
  relayServerMessageSchema,
} from "./protocol";
import type {
  ActiveRelaySession,
  RelayConnectionStatus,
  RelayDeliveryIdentity,
  RelayInstallResult,
  RelaySessionRequest,
} from "./types";

const RelayWebSocket = window.WebSocket;
const relayFetch = window.fetch.bind(window);
const browserCapabilities = new WeakMap<ActiveRelaySession, string>();

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

function webSocketUrl(session: ActiveRelaySession) {
  const url = new URL(`${session.endpoint}/v1/sessions/${session.sessionId}/connect`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export interface ArtifactRelayController {
  completeVerification: (turnstileToken: string) => Promise<void>;
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
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const processingQueue = useRef<Promise<void>>(Promise.resolve());
  const creationGeneration = useRef(0);
  const creatingGeneration = useRef<number | null>(null);
  const creationAbortControllers = useRef(new Set<AbortController>());
  const activeSessionRef = useRef<ActiveRelaySession | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const sessionGeneration = useRef(0);

  const invalidateSessionWork = useCallback(() => {
    sessionGeneration.current += 1;
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    processingQueue.current = Promise.resolve();
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
    const generation = sessionGeneration.current;
    const abortController = sessionAbortRef.current;
    const browserToken = browserCapabilities.get(session);
    if (!abortController || !browserToken) return;
    const connectionAbortController = new AbortController();
    const abortConnection = () => connectionAbortController.abort();
    abortController.signal.addEventListener("abort", abortConnection, { once: true });
    let cancelled = false;
    let reconnectTimer: number | undefined;
    const socket = new RelayWebSocket(
      webSocketUrl(session),
      [RELAY_WEBSOCKET_PROTOCOL, `browser.${browserToken}`],
    );
    socketRef.current = socket;
    setStatus(connectionAttempt ? "reconnecting" : "connecting");

    const sessionIsActive = () => !cancelled && !abortController.signal.aborted &&
      generation === sessionGeneration.current &&
      activeSessionRef.current?.sessionId === session.sessionId &&
      Date.parse(session.expiresAt) > Date.now();
    const connectionIsActive = () => sessionIsActive() && !connectionAbortController.signal.aborted;

    const sendAck = (deliveryId: string, outcome: "installed" | "rejected") => {
      if (!connectionIsActive() || socket.readyState !== RelayWebSocket.OPEN) return false;
      try {
        socket.send(JSON.stringify({
          version: RELAY_PROTOCOL_VERSION,
          type: "ack",
          deliveryId,
          outcome,
        }));
        return true;
      } catch {
        setStatus("reconnecting");
        setLastMessage("Relay acknowledgement was interrupted; reconnecting safely");
        try {
          socket.close(1011, "Retry acknowledgement after reconnect");
        } catch {
          // The close event or session alarm remains the retry boundary.
        }
        return false;
      }
    };

    socket.addEventListener("message", (event) => {
      if (!connectionIsActive()) return;
      let parsed;
      try {
        parsed = relayServerMessageSchema.parse(JSON.parse(String(event.data)));
      } catch {
        setStatus("error");
        setLastMessage("Relay sent an invalid protocol message");
        socket.close(1002, "Invalid relay message");
        return;
      }
      if (parsed.type === "ready") {
        if (parsed.sessionId !== session.sessionId || parsed.targetViewId !== session.targetViewId) {
          setStatus("error");
          setLastMessage("Relay session target changed unexpectedly");
          socket.close(1008, "Session target mismatch");
          return;
        }
        setStatus("connected");
        setLastMessage("Ready for encrypted deliveries");
        return;
      }
      if (parsed.type === "expired") {
        expireLocalSession();
        return;
      }
      if (parsed.type === "error") {
        setLastMessage(`Relay error: ${parsed.code}`);
        return;
      }

      const queued = processingQueue.current.catch(() => undefined).then(async () => {
        if (!connectionIsActive()) return;
        let decrypted;
        try {
          decrypted = await decryptRelayDelivery(
            parsed.delivery,
            session.encryptionKey,
            session.sessionId,
            session.targetViewId,
          );
        } catch (error) {
          if (!connectionIsActive()) return;
          setLastMessage(error instanceof Error
            ? `Delivery rejected: ${error.message}. Nothing was installed.`
            : "Delivery rejected. Nothing was installed.");
          sendAck(parsed.delivery.deliveryId, "rejected");
          return;
        }
        if (!connectionIsActive()) return;

        let result: RelayInstallResult;
        try {
          result = await onDelivery(session.targetViewId, decrypted.bundles, {
            targetViewId: session.targetViewId,
            targetViewTitle: session.targetViewTitle,
            stageSize: session.stageSize,
          }, {
            deliveryId: decrypted.deliveryId,
            sessionId: session.sessionId,
            signal: connectionAbortController.signal,
          });
        } catch (error) {
          if (!connectionIsActive()) return;
          if (error instanceof RelayDeliveryRejectedError) {
            setLastMessage(`Delivery rejected: ${error.message}. Nothing was installed.`);
            sendAck(parsed.delivery.deliveryId, "rejected");
            return;
          }
          setStatus("reconnecting");
          setLastMessage(error instanceof Error
            ? `Local install interrupted: ${error.message}. The encrypted delivery will retry.`
            : "Local install interrupted. The encrypted delivery will retry.");
          try {
            socket.close(1011, "Retry delivery after reconnect");
          } catch {
            // A closed socket leaves the delivery pending for the next connection.
          }
          return;
        }
        if (!connectionIsActive()) return;
        setLastMessage(
          `Installed ${result.artifactIds.length} artifact${result.artifactIds.length === 1 ? "" : "s"} into ${session.targetViewTitle}`,
        );
        sendAck(parsed.delivery.deliveryId, "installed");
      });
      processingQueue.current = queued.catch((error) => {
        if (!connectionIsActive()) return;
        setStatus("reconnecting");
        setLastMessage(error instanceof Error
          ? `Delivery processing interrupted: ${error.message}`
          : "Delivery processing interrupted");
        try {
          socket.close(1011, "Reset delivery queue");
        } catch {
          // A later connection replays every unacknowledged delivery.
        }
      });
    });

    socket.addEventListener("close", (event) => {
      if (!sessionIsActive()) return;
      connectionAbortController.abort();
      processingQueue.current = Promise.resolve();
      if (event.code === 4000) {
        expireLocalSession();
        return;
      }
      if (event.code === 4001) {
        setStatus("error");
        setLastMessage("This Build Session is active in another browser tab");
        return;
      }
      setStatus("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(connectionAttempt, 5));
      reconnectTimer = window.setTimeout(() => setConnectionAttempt((current) => current + 1), delay);
    });
    socket.addEventListener("error", () => {
      if (connectionIsActive()) setLastMessage("Relay connection interrupted; reconnecting");
    });

    return () => {
      cancelled = true;
      connectionAbortController.abort();
      processingQueue.current = Promise.resolve();
      abortController.signal.removeEventListener("abort", abortConnection);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close(1000, "Client state changed");
      } catch {
        // The socket was already closed.
      }
    };
  }, [connectionAttempt, expireLocalSession, onDelivery, session]);

  const stopSession = useCallback(async () => {
    const active = activeSessionRef.current;
    invalidateCreation();
    invalidateSessionWork();
    activeSessionRef.current = null;
    setSession(null);
    setRequest(null);
    setStatus("idle");
    setLastMessage("");
    socketRef.current?.close(1000, "Build Session closed");
    if (!active) return;
    const browserToken = browserCapabilities.get(active);
    if (!browserToken) return;
    try {
      await relayFetch(`${active.endpoint}/v1/sessions/${active.sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${browserToken}` },
      });
    } catch {
      // The server alarm remains the final cleanup boundary.
    }
  }, [invalidateCreation, invalidateSessionWork]);

  const requestSession = useCallback((nextRequest: RelaySessionRequest) => {
    setRequest(nextRequest);
    if (
      session &&
      session.targetViewId === nextRequest.targetViewId &&
      Date.parse(session.expiresAt) > Date.now()
    ) {
      setStatus(socketRef.current?.readyState === RelayWebSocket.OPEN ? "connected" : "reconnecting");
      setLastMessage("Reusing this view's active Build Session");
      return;
    }
    invalidateCreation(false);
    setStatus("verifying");
    setLastMessage("Verifying this Build Session");
  }, [invalidateCreation, session]);

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
      if (previous && previous.targetViewId !== requested.targetViewId) {
        const previousBrowserToken = browserCapabilities.get(previous);
        invalidateSessionWork();
        activeSessionRef.current = null;
        setSession(null);
        if (previousBrowserToken) {
          await relayFetch(`${previous.endpoint}/v1/sessions/${previous.sessionId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${previousBrowserToken}` },
          }).catch(() => undefined);
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
          browserTokenHash: await hashCapability(browserToken),
          uploadTokenHash: await hashCapability(uploadToken),
          turnstileToken,
        }),
      });
      const body = await response.json() as {
        sessionId?: string;
        targetViewId?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !body.sessionId || !body.expiresAt) {
        throw new Error(sessionCreationFailureMessage(body.error));
      }
      if (body.targetViewId !== requested.targetViewId) throw new Error("Relay returned a different target view");
      if (!creationIsCurrent()) {
        await relayFetch(`${RELAY_URL}/v1/sessions/${body.sessionId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${browserToken}` },
          keepalive: true,
        }).catch(() => undefined);
        return;
      }
      const active: ActiveRelaySession = {
        ...requested,
        endpoint: RELAY_URL,
        sessionId: body.sessionId,
        uploadToken,
        encryptionKey,
        expiresAt: body.expiresAt,
      };
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
    if (session && Date.parse(session.expiresAt) > Date.now()) {
      socketRef.current?.close(1012, "User requested reconnect");
      setStatus("reconnecting");
      setLastMessage("Reconnecting this browser to the Build Session");
      setConnectionAttempt((current) => current + 1);
      return;
    }
    if (!request) return;
    setStatus("verifying");
    setLastMessage("Verifying this Build Session");
  }, [request, session]);

  return {
    completeVerification,
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
