import { beforeEach, describe, expect, test, vi } from "vitest";
import { RelayDeliveryRejectedError } from "../src/relay/installDelivery";
import {
  RelayConnection,
  type RelayConnectionOptions,
  type RelayConnectionRuntime,
  type RelayWebSocketConstructor,
} from "../src/relay/relayConnection";
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_EXPIRY_SKEW_MS,
  RELAY_SESSION_TTL_MS,
  relayCapabilitySchema,
  relaySessionCreatedSchema,
  type EncryptedRelayDelivery,
} from "../src/relay/protocol";
import type { ActiveRelaySession } from "../src/relay/types";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_DELIVERY_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_DELIVERY_ID = "33333333-3333-4333-8333-333333333333";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly sent: string[] = [];
  readonly url: string;
  readonly protocols: string[];
  readyState = FakeWebSocket.OPEN;
  throwOnSend = false;

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocols = typeof protocols === "string" ? [protocols] : protocols ?? [];
    FakeWebSocket.instances.push(this);
  }

  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  send(value: string) {
    if (this.throwOnSend) throw new Error("Simulated send failure");
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("Socket is not open");
    this.sent.push(value);
  }

  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  serverClose(code: number, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event("close") as CloseEvent;
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
      wasClean: { value: code === 1000 },
    });
    this.dispatchEvent(event);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function delivery(deliveryId: string): EncryptedRelayDelivery {
  return {
    version: RELAY_PROTOCOL_VERSION,
    deliveryId,
    artifactCount: 1,
    createdAt: "2030-01-01T00:00:00.000Z",
    iv: "AAAAAAAAAAAAAAAA",
    ciphertext: "BBBBBBBBBBBBBBBB",
  };
}

function ready(session: ActiveRelaySession, incarnationId = session.targetViewIncarnationId) {
  return {
    version: RELAY_PROTOCOL_VERSION,
    type: "ready" as const,
    sessionId: session.sessionId,
    targetViewId: session.targetViewId,
    targetViewIncarnationId: incarnationId,
    expiresAt: session.expiresAt,
  };
}

function parseSent(socket: FakeWebSocket) {
  return socket.sent.map((message) => JSON.parse(message) as {
    deliveryId: string;
    outcome: "installed" | "rejected";
    type: "ack";
    version: number;
  });
}

function createHarness(
  overrides: Partial<RelayConnectionOptions> = {},
  runtimeOverrides: Partial<RelayConnectionRuntime> = {},
) {
  const session: ActiveRelaySession = {
    endpoint: "https://relay.example.test",
    sessionId: SESSION_ID,
    uploadToken: "upload-token",
    encryptionKey: "encryption-key",
    expiresAt: "2099-01-01T00:00:00.000Z",
    targetViewId: "market-overview",
    targetViewIncarnationId: "incarnation-a",
    targetViewTitle: "Market overview",
    stageSize: { width: 1_280, height: 720 },
  };
  const parentController = new AbortController();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerSequence = 0;
  const decrypt = vi.fn(async (encrypted: EncryptedRelayDelivery) => ({
    version: RELAY_PROTOCOL_VERSION,
    deliveryId: encrypted.deliveryId,
    bundles: [{ artifactId: encrypted.deliveryId }],
  }));
  const runtime: RelayConnectionRuntime = {
    WebSocket: FakeWebSocket as unknown as RelayWebSocketConstructor,
    clearTimeout: (timer) => { timers.delete(timer); },
    decrypt,
    now: () => Date.parse("2030-01-01T00:00:00.000Z"),
    setTimeout: (callback, delay) => {
      const id = ++timerSequence;
      timers.set(id, {
        callback: () => {
          timers.delete(id);
          callback();
        },
        delay,
      });
      return id;
    },
    ...runtimeOverrides,
  };
  const events = {
    onDeliveryOutcome: vi.fn(),
    onExpire: vi.fn(),
    onMessage: vi.fn(),
    onReconnect: vi.fn(),
    onSocket: vi.fn(),
    onStatus: vi.fn(),
  };
  const onDelivery = vi.fn<RelayConnectionOptions["onDelivery"]>(async (_target, bundles) => ({
    artifactIds: [(bundles[0] as { artifactId: string }).artifactId],
    nodeIds: ["node-1"],
  }));
  const connection = new RelayConnection({
    attempt: 0,
    browserToken: "browser-token",
    events,
    onDelivery,
    parentSignal: parentController.signal,
    runtime,
    session,
    ...overrides,
  });
  return { connection, decrypt, events, onDelivery, parentController, runtime, session, timers };
}

function makeHarness(overrides: Partial<RelayConnectionOptions> = {}) {
  const harness = createHarness(overrides);
  const { connection } = harness;
  connection.start();
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("Expected RelayConnection to create a WebSocket");
  return { ...harness, socket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe("RelayConnection", () => {
  test("accepts only a strict, current v2 session creation response and valid capabilities", () => {
    const valid = {
      version: RELAY_PROTOCOL_VERSION,
      sessionId: SESSION_ID,
      targetViewId: "market-overview",
      targetViewIncarnationId: "incarnation-a",
      expiresAt: new Date(Date.now() + RELAY_SESSION_TTL_MS).toISOString(),
    };
    expect(relaySessionCreatedSchema.safeParse(valid).success).toBe(true);
    expect(relayCapabilitySchema.safeParse("A".repeat(43)).success).toBe(true);

    for (const invalid of [
      { ...valid, version: 1 },
      { ...valid, version: RELAY_PROTOCOL_VERSION + 1 },
      { ...valid, sessionId: "not-a-session-id" },
      { ...valid, expiresAt: "not-a-date" },
      { ...valid, expiresAt: "2000-01-01T00:00:00.000Z" },
      {
        ...valid,
        expiresAt: new Date(
          Date.now() + RELAY_SESSION_TTL_MS + RELAY_SESSION_EXPIRY_SKEW_MS + 60_000,
        ).toISOString(),
      },
      { ...valid, browserCapability: "A".repeat(43), uploadToken: "B".repeat(43) },
      { ...valid, unexpected: true },
    ]) {
      expect(relaySessionCreatedSchema.safeParse(invalid).success).toBe(false);
    }
    expect(relayCapabilitySchema.safeParse("A".repeat(42)).success).toBe(false);
    expect(relayCapabilitySchema.safeParse(`${"A".repeat(42)}+`).success).toBe(false);
  });

  test("rejects a ready message for a different target incarnation without reconnecting", () => {
    const { events, session, socket, timers } = makeHarness();

    socket.receive(ready(session, "incarnation-restored-after-session-opened"));
    // Browser WebSockets emit close asynchronously after client-side close().
    // A terminal target mismatch must not be reclassified as a retryable drop.
    socket.serverClose(1008, "Session target mismatch");

    expect(events.onStatus).toHaveBeenLastCalledWith("error");
    expect(events.onMessage).toHaveBeenLastCalledWith("Relay session target changed unexpectedly");
    expect(socket.closes).toContainEqual({ code: 1008, reason: "Session target mismatch" });
    expect(events.onDeliveryOutcome).not.toHaveBeenCalled();
    expect(events.onReconnect).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
    expect(socket.sent).toEqual([]);
  });

  test("keeps a server protocol error terminal and visible until an explicit retry", () => {
    const { events, socket, timers } = makeHarness();

    socket.receive({
      version: RELAY_PROTOCOL_VERSION,
      type: "error",
      code: "invalid_message",
    });
    socket.serverClose(1002, "Relay protocol error");

    expect(events.onStatus).toHaveBeenLastCalledWith("error");
    expect(events.onMessage).toHaveBeenLastCalledWith(
      "Relay rejected the browser protocol: invalid_message",
    );
    expect(socket.closes).toContainEqual({ code: 1002, reason: "Relay protocol error" });
    expect(events.onReconnect).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  test("turns a synchronous WebSocket constructor failure into a retryable terminal state", () => {
    const ThrowingWebSocket = class {
      static readonly OPEN = 1;

      constructor() {
        throw new Error("WebSocket construction is blocked");
      }
    } as unknown as RelayWebSocketConstructor;
    const { connection, events, timers } = createHarness({}, { WebSocket: ThrowingWebSocket });

    expect(() => connection.start()).not.toThrow();

    expect(events.onStatus).toHaveBeenLastCalledWith("error");
    expect(events.onMessage).toHaveBeenLastCalledWith(
      "Relay connection could not be opened. Retry this Build Session.",
    );
    expect(events.onSocket).toHaveBeenLastCalledWith(null);
    expect(events.onReconnect).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  test("reconnects a socket that stays silent instead of waiting forever for ready", () => {
    const { events, socket, timers } = makeHarness();

    expect([...timers.values()].map(({ delay }) => delay)).toEqual([10_000]);
    [...timers.values()][0]?.callback();

    expect(events.onStatus).toHaveBeenLastCalledWith("reconnecting");
    expect(events.onMessage).toHaveBeenLastCalledWith(
      "Relay did not confirm the Build Session; reconnecting safely",
    );
    expect(socket.closes).toContainEqual({
      code: 1012,
      reason: "Relay ready handshake timed out",
    });
    expect([...timers.values()].map(({ delay }) => delay)).toEqual([500]);

    socket.serverClose(1012, "Relay ready handshake timed out");
    expect([...timers.values()].map(({ delay }) => delay)).toEqual([500]);
    [...timers.values()][0]?.callback();
    expect(events.onReconnect).toHaveBeenCalledOnce();
  });

  test("clears the ready watchdog after a strict ready message and on stop", () => {
    const connected = makeHarness();

    expect(connected.timers.size).toBe(1);
    connected.socket.receive(ready(connected.session));
    expect(connected.events.onStatus).toHaveBeenLastCalledWith("connected");
    expect(connected.timers.size).toBe(0);

    const stopped = makeHarness();
    expect(stopped.timers.size).toBe(1);
    stopped.connection.stop();
    expect(stopped.timers.size).toBe(0);
  });

  test("expires instead of reconnecting when the ready deadline reaches session expiry", () => {
    let now = Date.parse("2030-01-01T00:00:00.000Z");
    const harness = createHarness({}, { now: () => now });
    harness.session.expiresAt = new Date(now + 4_000).toISOString();
    harness.connection.start();
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("Expected RelayConnection to create a WebSocket");

    expect([...harness.timers.values()].map(({ delay }) => delay)).toEqual([4_000]);
    now += 4_000;
    [...harness.timers.values()][0]?.callback();

    expect(harness.events.onExpire).toHaveBeenCalledOnce();
    expect(harness.events.onReconnect).not.toHaveBeenCalled();
    expect(harness.events.onStatus).not.toHaveBeenCalledWith("reconnecting");
    expect(socket.closes).toContainEqual({ code: 1000, reason: "Build Session expired" });
    expect(harness.timers.size).toBe(0);
  });

  test("schedules a bounded reconnect after an interrupted socket", () => {
    const { events, socket, timers } = makeHarness({ attempt: 3 });

    socket.serverClose(1012, "rolling restart");

    expect(events.onStatus).toHaveBeenLastCalledWith("reconnecting");
    expect(events.onMessage).toHaveBeenLastCalledWith("Relay connection interrupted; reconnecting safely");
    expect([...timers.values()].map(({ delay }) => delay)).toEqual([4_000]);
    [...timers.values()][0]?.callback();
    expect(events.onReconnect).toHaveBeenCalledOnce();
  });

  test("installs and acknowledges deliveries strictly in arrival order", async () => {
    const first = deferred<{ artifactIds: string[]; nodeIds: string[] }>();
    const second = deferred<{ artifactIds: string[]; nodeIds: string[] }>();
    const onDelivery = vi.fn<RelayConnectionOptions["onDelivery"]>((_target, bundles) => {
      const artifactId = (bundles[0] as { artifactId: string }).artifactId;
      return artifactId === FIRST_DELIVERY_ID ? first.promise : second.promise;
    });
    const { socket } = makeHarness({ onDelivery });
    socket.receive({ version: RELAY_PROTOCOL_VERSION, type: "delivery", delivery: delivery(FIRST_DELIVERY_ID) });
    socket.receive({ version: RELAY_PROTOCOL_VERSION, type: "delivery", delivery: delivery(SECOND_DELIVERY_ID) });

    await vi.waitFor(() => expect(onDelivery).toHaveBeenCalledTimes(1));
    expect((onDelivery.mock.calls[0]?.[1][0] as { artifactId: string }).artifactId).toBe(FIRST_DELIVERY_ID);
    expect(socket.sent).toEqual([]);

    first.resolve({ artifactIds: [FIRST_DELIVERY_ID], nodeIds: ["node-first"] });
    await vi.waitFor(() => expect(onDelivery).toHaveBeenCalledTimes(2));
    expect((onDelivery.mock.calls[1]?.[1][0] as { artifactId: string }).artifactId).toBe(SECOND_DELIVERY_ID);
    expect(parseSent(socket)).toEqual([expect.objectContaining({
      deliveryId: FIRST_DELIVERY_ID,
      outcome: "installed",
    })]);

    second.resolve({ artifactIds: [SECOND_DELIVERY_ID], nodeIds: ["node-second"] });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(parseSent(socket).map(({ deliveryId, outcome }) => ({ deliveryId, outcome }))).toEqual([
      { deliveryId: FIRST_DELIVERY_ID, outcome: "installed" },
      { deliveryId: SECOND_DELIVERY_ID, outcome: "installed" },
    ]);
  });

  test.each([
    ["explicit stop", (harness: ReturnType<typeof makeHarness>) => harness.connection.stop()],
    ["parent abort", (harness: ReturnType<typeof makeHarness>) => harness.parentController.abort()],
  ])("does not emit an outcome or ACK after %s cancels an in-flight install", async (_label, cancel) => {
    const install = deferred<{ artifactIds: string[]; nodeIds: string[] }>();
    const onDelivery = vi.fn<RelayConnectionOptions["onDelivery"]>(() => install.promise);
    const harness = makeHarness({ onDelivery });
    harness.socket.receive({
      version: RELAY_PROTOCOL_VERSION,
      type: "delivery",
      delivery: delivery(FIRST_DELIVERY_ID),
    });
    await vi.waitFor(() => expect(onDelivery).toHaveBeenCalledOnce());

    cancel(harness);
    install.resolve({ artifactIds: [FIRST_DELIVERY_ID], nodeIds: ["node-first"] });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.events.onDeliveryOutcome).not.toHaveBeenCalled();
    expect(harness.socket.sent).toEqual([]);
  });

  test("sends a rejected ACK when local validation rejects a delivery", async () => {
    const onDelivery = vi.fn<RelayConnectionOptions["onDelivery"]>(async () => {
      throw new RelayDeliveryRejectedError("Artifact selection failed validation");
    });
    const { events, socket } = makeHarness({ onDelivery });

    socket.receive({
      version: RELAY_PROTOCOL_VERSION,
      type: "delivery",
      delivery: delivery(FIRST_DELIVERY_ID),
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(parseSent(socket)).toEqual([expect.objectContaining({
      deliveryId: FIRST_DELIVERY_ID,
      outcome: "rejected",
    })]);
    expect(events.onDeliveryOutcome).toHaveBeenLastCalledWith({
      kind: "rejected",
      summary: "Delivery rejected. Nothing was installed.",
      detail: "Artifact selection failed validation",
    });
  });

  test("rejects and acknowledges ciphertext that cannot be decrypted", async () => {
    const decrypt = vi.fn(async () => {
      throw new Error("Ciphertext authentication failed");
    });
    const harness = createHarness({}, { decrypt });
    harness.connection.start();
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("Expected RelayConnection to create a WebSocket");

    socket.receive({
      version: RELAY_PROTOCOL_VERSION,
      type: "delivery",
      delivery: delivery(FIRST_DELIVERY_ID),
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(harness.onDelivery).not.toHaveBeenCalled();
    expect(parseSent(socket)).toEqual([expect.objectContaining({
      deliveryId: FIRST_DELIVERY_ID,
      outcome: "rejected",
    })]);
    expect(harness.events.onDeliveryOutcome).toHaveBeenLastCalledWith({
      kind: "rejected",
      summary: "Delivery rejected. Nothing was installed.",
      detail: "Ciphertext authentication failed",
    });
  });

  test("schedules reconnect directly when sending an acknowledgement throws", async () => {
    const harness = makeHarness();
    harness.socket.throwOnSend = true;
    harness.socket.receive({
      version: RELAY_PROTOCOL_VERSION,
      type: "delivery",
      delivery: delivery(FIRST_DELIVERY_ID),
    });

    await vi.waitFor(() => expect(harness.events.onDeliveryOutcome).toHaveBeenCalledOnce());
    expect(harness.events.onStatus).toHaveBeenLastCalledWith("reconnecting");
    expect(harness.events.onMessage).toHaveBeenLastCalledWith(
      "Relay acknowledgement was interrupted; reconnecting safely",
    );
    expect(harness.socket.closes).toContainEqual({
      code: 1011,
      reason: "Retry acknowledgement after reconnect",
    });
    expect([...harness.timers.values()].map(({ delay }) => delay)).toEqual([500]);

    harness.socket.serverClose(1011, "Retry acknowledgement after reconnect");
    expect([...harness.timers.values()].map(({ delay }) => delay)).toEqual([500]);
    [...harness.timers.values()][0]?.callback();
    expect(harness.events.onReconnect).toHaveBeenCalledOnce();
  });
});
