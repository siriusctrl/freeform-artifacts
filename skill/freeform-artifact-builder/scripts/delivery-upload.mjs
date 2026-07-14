const SAFE_RELAY_ERROR_PATTERN = /^[a-z0-9_]{1,64}$/;

export class RelayUploadError extends Error {
  constructor(message, outcome) {
    super(message);
    this.name = "RelayUploadError";
    this.outcome = outcome;
  }
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeRelayErrorCode(body, status) {
  return typeof body?.error === "string" && SAFE_RELAY_ERROR_PATTERN.test(body.error)
    ? body.error
    : `HTTP ${status}`;
}

export async function uploadDelivery(url, token, delivery, {
  fetchImpl = globalThis.fetch,
  wait = delay,
} = {}) {
  let lastMessage = "Relay request failed";
  let sawAmbiguousOutcome = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Relay request timed out")), 15_000);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(delivery),
        signal: controller.signal,
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        // Preserve the status-based error without reflecting an untrusted body.
      }
      if (response.ok && body.accepted === true && body.deliveryId === delivery.deliveryId) return body;
      const code = safeRelayErrorCode(body, response.status);
      if (!response.ok && response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw new RelayUploadError(
          `Relay rejected delivery: ${code}`,
          sawAmbiguousOutcome ? "unknown" : "rejected",
        );
      }
      if (response.ok || response.status >= 500 || response.status === 408) sawAmbiguousOutcome = true;
      lastMessage = response.ok
        ? "Relay returned an invalid acknowledgement"
        : `Relay temporarily refused delivery: ${code}`;
    } catch (error) {
      if (error instanceof RelayUploadError) throw error;
      lastMessage = "Relay request failed";
      sawAmbiguousOutcome = true;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await wait(500 * 2 ** attempt);
  }
  throw new RelayUploadError(lastMessage, sawAmbiguousOutcome ? "unknown" : "rejected");
}
