import { RelayDeliveryRejectedError } from "./installDelivery";
import { formatArtifactValidationMessage } from "../artifacts/validationMessage";
import { decryptRelayDelivery } from "./crypto";
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_WEBSOCKET_PROTOCOL,
  relayServerMessageSchema,
  type EncryptedRelayDelivery,
} from "./protocol";
import type {
  ActiveRelaySession,
  RelayConnectionStatus,
  RelayDeliveryIdentity,
  RelayDeliveryOutcome,
  RelayInstallResult,
  RelaySessionRequest,
} from "./types";

const RELAY_READY_TIMEOUT_MS = 10_000;

export interface RelayWebSocketConstructor {
  readonly OPEN: number;
  new(url: string, protocols?: string | string[]): WebSocket;
}

export interface RelayConnectionRuntime {
  WebSocket: RelayWebSocketConstructor;
  clearTimeout: (timer: number) => void;
  decrypt: typeof decryptRelayDelivery;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => number;
}

interface RelayConnectionEvents {
  onDeliveryOutcome: (outcome: RelayDeliveryOutcome) => void;
  onExpire: () => void;
  onMessage: (message: string) => void;
  onReconnect: () => void;
  onSocket: (socket: WebSocket | null) => void;
  onStatus: (status: RelayConnectionStatus) => void;
}

export interface RelayConnectionOptions {
  attempt: number;
  browserToken: string;
  events: RelayConnectionEvents;
  onDelivery: (
    targetViewId: string,
    bundles: unknown[],
    placement: RelaySessionRequest,
    identity: RelayDeliveryIdentity,
  ) => Promise<RelayInstallResult>;
  parentSignal: AbortSignal;
  runtime: RelayConnectionRuntime;
  session: ActiveRelaySession;
}

function webSocketUrl(session: ActiveRelaySession) {
  const url = new URL(`${session.endpoint}/v1/sessions/${session.sessionId}/connect`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class RelayConnection {
  private readonly connectionAbortController = new AbortController();
  private readonly runtime: RelayConnectionRuntime;
  private processingQueue = Promise.resolve();
  private readyConfirmed = false;
  private readyTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private socket: WebSocket | null = null;
  private stopped = false;

  constructor(private readonly options: RelayConnectionOptions) {
    this.runtime = options.runtime;
    options.parentSignal.addEventListener("abort", this.handleParentAbort, { once: true });
  }

  start() {
    if (this.stopped || this.options.parentSignal.aborted) return;
    if (this.sessionHasExpired()) {
      this.expireSession();
      return;
    }
    const { WebSocket } = this.runtime;
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        webSocketUrl(this.options.session),
        [RELAY_WEBSOCKET_PROTOCOL, `browser.${this.options.browserToken}`],
      );
    } catch {
      if (this.sessionHasExpired()) {
        this.expireSession();
        return;
      }
      this.options.events.onStatus("error");
      this.options.events.onMessage("Relay connection could not be opened. Retry this Build Session.");
      this.stop(1000, "Relay connection could not be opened");
      return;
    }
    this.socket = socket;
    this.options.events.onSocket(socket);
    this.options.events.onStatus(this.options.attempt ? "reconnecting" : "connecting");
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("error", this.handleError);
    const remaining = Date.parse(this.options.session.expiresAt) - this.runtime.now();
    this.readyTimer = this.runtime.setTimeout(
      this.handleReadyTimeout,
      Math.min(RELAY_READY_TIMEOUT_MS, remaining),
    );
  }

  stop(code = 1000, reason = "Client state changed") {
    if (this.stopped) return;
    this.stopped = true;
    this.connectionAbortController.abort();
    this.processingQueue = Promise.resolve();
    this.options.parentSignal.removeEventListener("abort", this.handleParentAbort);
    this.clearReadyTimer();
    if (this.reconnectTimer !== undefined) {
      this.runtime.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = null;
    this.options.events.onSocket(null);
    if (!socket) return;
    socket.removeEventListener("message", this.handleMessage);
    socket.removeEventListener("close", this.handleClose);
    socket.removeEventListener("error", this.handleError);
    try {
      socket.close(code, reason);
    } catch {
      // The WebSocket already reached a terminal state.
    }
  }

  closeForReconnect(reason: string) {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.close(1012, reason);
    } catch {
      // The close event or session alarm remains the retry boundary.
    }
  }

  private readonly handleParentAbort = () => this.stop(1000, "Build Session closed");

  private sessionHasExpired() {
    return this.runtime.now() >= Date.parse(this.options.session.expiresAt);
  }

  private sessionIsActive() {
    return !this.stopped &&
      !this.options.parentSignal.aborted &&
      !this.sessionHasExpired();
  }

  private connectionIsActive() {
    return this.sessionIsActive() && !this.connectionAbortController.signal.aborted;
  }

  private clearReadyTimer() {
    if (this.readyTimer === undefined) return;
    this.runtime.clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }

  private expireSession() {
    if (this.stopped || this.options.parentSignal.aborted) return;
    this.options.events.onExpire();
    this.stop(1000, "Build Session expired");
  }

  private scheduleReconnect(message: string) {
    if (!this.sessionIsActive()) {
      if (this.sessionHasExpired()) this.expireSession();
      return;
    }
    if (this.reconnectTimer !== undefined) return;
    this.clearReadyTimer();
    this.connectionAbortController.abort();
    this.processingQueue = Promise.resolve();
    this.options.events.onStatus("reconnecting");
    this.options.events.onMessage(message);
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.options.attempt, 5));
    this.reconnectTimer = this.runtime.setTimeout(() => {
      if (this.sessionHasExpired()) {
        this.expireSession();
        return;
      }
      if (this.sessionIsActive()) this.options.events.onReconnect();
    }, delay);
  }

  private readonly handleReadyTimeout = () => {
    this.readyTimer = undefined;
    if (this.readyConfirmed || this.stopped || this.options.parentSignal.aborted) return;
    if (this.sessionHasExpired()) {
      this.expireSession();
      return;
    }
    this.scheduleReconnect("Relay did not confirm the Build Session; reconnecting safely");
    try {
      this.socket?.close(1012, "Relay ready handshake timed out");
    } catch {
      // The scheduled reconnect does not depend on a close event.
    }
  };

  private sendAck(deliveryId: string, outcome: "installed" | "rejected") {
    const socket = this.socket;
    if (!socket || !this.connectionIsActive() || socket.readyState !== this.runtime.WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify({
        version: RELAY_PROTOCOL_VERSION,
        type: "ack",
        deliveryId,
        outcome,
      }));
      return true;
    } catch {
      this.scheduleReconnect("Relay acknowledgement was interrupted; reconnecting safely");
      try {
        socket.close(1011, "Retry acknowledgement after reconnect");
      } catch {
        // The reconnect timer no longer depends on a close event.
      }
      return false;
    }
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (!this.connectionIsActive()) return;
    let parsed;
    try {
      parsed = relayServerMessageSchema.parse(JSON.parse(String(event.data)));
    } catch {
      this.options.events.onStatus("error");
      this.options.events.onMessage("Relay sent an invalid protocol message");
      this.stop(1002, "Invalid relay message");
      return;
    }
    const { session } = this.options;
    if (parsed.type === "ready") {
      if (
        parsed.sessionId !== session.sessionId ||
        parsed.targetViewId !== session.targetViewId ||
        parsed.targetViewIncarnationId !== session.targetViewIncarnationId
      ) {
        this.options.events.onStatus("error");
        this.options.events.onMessage("Relay session target changed unexpectedly");
        this.stop(1008, "Session target mismatch");
        return;
      }
      this.readyConfirmed = true;
      this.clearReadyTimer();
      this.options.events.onStatus("connected");
      this.options.events.onMessage("Ready for encrypted deliveries");
      return;
    }
    if (parsed.type === "expired") {
      this.options.events.onExpire();
      return;
    }
    if (parsed.type === "error") {
      this.options.events.onStatus("error");
      this.options.events.onMessage(`Relay rejected the browser protocol: ${parsed.code}`);
      this.stop(1002, "Relay protocol error");
      return;
    }
    this.enqueueDelivery(parsed.delivery);
  };

  private enqueueDelivery(delivery: EncryptedRelayDelivery) {
    const queued = this.processingQueue.catch(() => undefined).then(async () => {
      if (!this.connectionIsActive()) return;
      const { session } = this.options;
      let decrypted;
      try {
        decrypted = await this.runtime.decrypt(
          delivery,
          session.encryptionKey,
          session.sessionId,
          session.targetViewId,
          session.targetViewIncarnationId,
        );
      } catch (error) {
        if (!this.connectionIsActive()) return;
        this.options.events.onDeliveryOutcome({
          kind: "rejected",
          summary: "Delivery rejected. Nothing was installed.",
          detail: error instanceof Error ? error.message : undefined,
        });
        this.sendAck(delivery.deliveryId, "rejected");
        return;
      }
      if (!this.connectionIsActive()) return;

      let result: RelayInstallResult;
      try {
        result = await this.options.onDelivery(session.targetViewId, decrypted.bundles, {
          targetViewId: session.targetViewId,
          targetViewIncarnationId: session.targetViewIncarnationId,
          targetViewTitle: session.targetViewTitle,
          stageSize: session.stageSize,
        }, {
          deliveryId: decrypted.deliveryId,
          sessionId: session.sessionId,
          signal: this.connectionAbortController.signal,
        });
      } catch (error) {
        if (!this.connectionIsActive()) return;
        if (error instanceof RelayDeliveryRejectedError) {
          this.options.events.onDeliveryOutcome({
            kind: "rejected",
            summary: "Delivery rejected. Nothing was installed.",
            detail: formatArtifactValidationMessage(error.message),
          });
          this.sendAck(delivery.deliveryId, "rejected");
          return;
        }
        this.options.events.onStatus("reconnecting");
        this.options.events.onMessage(error instanceof Error
          ? `Relay interrupted during local install: ${error.message}. Reconnecting safely.`
          : "Relay interrupted during local install. Reconnecting safely.");
        try {
          this.socket?.close(1011, "Retry delivery after reconnect");
        } catch {
          // A closed socket leaves the delivery pending for the next connection.
        }
        return;
      }
      if (!this.connectionIsActive()) return;
      this.options.events.onDeliveryOutcome({
        kind: "installed",
        summary: `Installed ${result.artifactIds.length} artifact${result.artifactIds.length === 1 ? "" : "s"} into ${session.targetViewTitle}`,
      });
      this.sendAck(delivery.deliveryId, "installed");
    });
    this.processingQueue = queued.catch((error) => {
      if (!this.connectionIsActive()) return;
      this.options.events.onStatus("reconnecting");
      this.options.events.onMessage(error instanceof Error
        ? `Relay interrupted during delivery processing: ${error.message}. Reconnecting safely.`
        : "Relay interrupted during delivery processing. Reconnecting safely.");
      try {
        this.socket?.close(1011, "Reset delivery queue");
      } catch {
        // A later connection replays every unacknowledged delivery.
      }
    });
  }

  private readonly handleClose = (event: CloseEvent) => {
    if (this.stopped || this.options.parentSignal.aborted) return;
    this.clearReadyTimer();
    if (event.code === 4000 || this.sessionHasExpired()) {
      this.expireSession();
      return;
    }
    if (event.code === 4001) {
      this.options.events.onStatus("error");
      this.options.events.onMessage("This Build Session is active in another browser tab");
      this.stop(1008, "Build Session active in another tab");
      return;
    }
    this.scheduleReconnect("Relay connection interrupted; reconnecting safely");
  };

  private readonly handleError = () => {
    if (this.connectionIsActive()) {
      this.options.events.onMessage("Relay connection interrupted; reconnecting");
    }
  };
}
