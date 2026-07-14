import { writeFileSync } from "node:fs";

export function createUxVerifier(uxChecksPath) {
  const uxChecks = [];

  function verifyUx(name, condition, details = {}) {
    const check = { name, passed: Boolean(condition), details };
    uxChecks.push(check);
    writeFileSync(uxChecksPath, `${JSON.stringify(uxChecks, null, 2)}\n`);
    if (!check.passed) {
      throw new Error(`UX check failed: ${name}\n${JSON.stringify(details, null, 2)}`);
    }
  }

  return { uxChecks, verifyUx };
}

export async function configureProofBrowserContext(context, { relayUrl, appUrl }) {
  const state = {
    sessionCreationAttempts: 0,
    routedSockets: [],
    delayNextRelaySocket: false,
  };

  await context.route(`${relayUrl}/v1/sessions`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    state.sessionCreationAttempts += 1;
    if (state.sessionCreationAttempts > 1) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": appUrl,
        "Vary": "Origin",
      },
      body: JSON.stringify({ error: "temporarily_unavailable" }),
    });
  });
  await context.routeWebSocket(/\/v1\/sessions\/[^/]+\/connect(?:\?|$)/, async (browserSocket) => {
    if (state.delayNextRelaySocket) {
      state.delayNextRelaySocket = false;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const serverSocket = browserSocket.connectToServer();
    state.routedSockets.push({ browserSocket, serverSocket });
  });
  await context.addInitScript(() => {
    let callback;
    let challenge;
    window.turnstile = {
      render: (container, options) => {
        callback = options.callback;
        window.__proofTurnstileOptions = { size: options.size, theme: options.theme };
        challenge = document.createElement("iframe");
        challenge.dataset.testid = "proof-turnstile-challenge-frame";
        challenge.title = "Cloudflare test security challenge";
        challenge.srcdoc = "<!doctype html><title>Security check</title><button>Verify browser</button>";
        challenge.style.width = "100%";
        challenge.style.height = "65px";
        challenge.style.border = "0";
        container.append(challenge);
        return "proof-turnstile";
      },
      execute: () => window.setTimeout(() => callback?.("test-turnstile-pass"), 3_000),
      remove: () => {
        callback = undefined;
        challenge?.remove();
        challenge = undefined;
      },
    };
  });

  return {
    get routedSockets() {
      return state.routedSockets;
    },
    get sessionCreationAttempts() {
      return state.sessionCreationAttempts;
    },
    delayNextSocket() {
      state.delayNextRelaySocket = true;
    },
  };
}

export function worldPoint(viewport, screenPoint) {
  return {
    x: (screenPoint.x - viewport.x) / viewport.scale,
    y: (screenPoint.y - viewport.y) / viewport.scale,
  };
}

export function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export async function installProofOverlay(page) {
  await page.evaluate(() => {
    document.querySelector("[data-proof-overlay]")?.remove();
    const overlay = document.createElement("div");
    overlay.dataset.proofOverlay = "true";
    overlay.innerHTML = '<div class="proof-step"></div><div class="proof-cursor"></div>';
    const style = document.createElement("style");
    style.textContent = `
      [data-proof-overlay] { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
      .proof-step { position: absolute; left: 24px; top: 72px; padding: 9px 13px; color: #fff;
        background: rgba(17, 20, 24, .9); border: 1px solid rgba(255,255,255,.18); border-radius: 6px;
        font: 600 13px/1.2 "Instrument Sans Variable", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
      .proof-cursor { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border: 2px solid #111418; border-radius: 50%; background: rgba(255,255,255,.72);
        box-shadow: 0 0 0 3px rgba(82,196,218,.55); transform: translate(-30px,-30px); }
      @media (max-width: 700px) {
        .proof-step { left: 12px; top: 8px; max-width: calc(100vw - 24px); padding: 6px 9px; font-size: 11px; }
      }
      @media (max-height: 500px) {
        .proof-step { display: none; }
      }
    `;
    overlay.append(style);
    document.body.append(overlay);
    window.addEventListener("pointermove", (event) => {
      const cursor = overlay.querySelector(".proof-cursor");
      if (cursor instanceof HTMLElement) {
        cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      }
    });
  });
}

export async function showProofStep(page, label, pause = 500) {
  await page.evaluate((nextLabel) => {
    const step = document.querySelector("[data-proof-overlay] .proof-step");
    if (step) step.textContent = nextLabel;
  }, label);
  await page.waitForTimeout(pause);
}

export async function dispatchPinch(page, stage, point, deltaY, count) {
  await stage.evaluate(async (element, gesture) => {
    for (let index = 0; index < gesture.count; index += 1) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: gesture.point.x,
          clientY: gesture.point.y,
          ctrlKey: true,
          deltaY: gesture.deltaY,
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 32));
    }
  }, { point, deltaY, count });
  await page.waitForTimeout(250);
}

export async function findBlankStagePoint(page, stageBox) {
  const candidates = [];
  for (let y = stageBox.y + 100; y < stageBox.y + stageBox.height - 80; y += 80) {
    for (let x = stageBox.x + 80; x < stageBox.x + stageBox.width - 80; x += 100) {
      candidates.push({ x, y });
    }
  }

  return page.evaluate((points) => {
    return points.find(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(
        target?.closest('[data-testid="canvas-stage"]') &&
        !target.closest(".canvas-node, button, a, input, textarea, select"),
      );
    });
  }, candidates);
}

export async function chartLabelLayout(page, hostTestId, labels) {
  return page.getByTestId(hostTestId).evaluate((host, expectedLabels) => {
    const hostRect = host.getBoundingClientRect();
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = expectedLabels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside =
          rect.left < hostRect.left - 1 ||
          rect.right > hostRect.right + 1 ||
          rect.top < hostRect.top - 1 ||
          rect.bottom > hostRect.bottom + 1;
        return outside ? [{ label, hostRight: hostRect.right, textRight: rect.right }] : [];
      }),
    };
  }, labels);
}

export async function artifactPreviewGeometry(page, artifactId) {
  const preview = page.getByTestId(`artifact-preview-${artifactId}`);
  await preview.scrollIntoViewIfNeeded();
  await preview.waitFor({ state: "visible" });
  await page.waitForFunction(
    (id) => document.querySelector(`[data-testid="artifact-preview-${id}"]`)?.getAttribute("data-preview-ready") === "true",
    artifactId,
  );
  return preview.evaluate((frame) => {
    const node = frame.querySelector(".artifact-preview-node");
    if (!(node instanceof HTMLElement)) return null;
    const frameRect = frame.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      artifactId: frame.dataset.testid,
      scale: Number(frame.getAttribute("data-preview-scale")),
      frame: { width: frameRect.width, height: frameRect.height },
      node: { width: nodeRect.width, height: nodeRect.height },
      contained:
        nodeRect.left >= frameRect.left - 1 &&
        nodeRect.right <= frameRect.right + 1 &&
        nodeRect.top >= frameRect.top - 1 &&
        nodeRect.bottom <= frameRect.bottom + 1,
    };
  });
}

export async function probabilityNoteLayout(page) {
  return page.getByTestId("echarts-inflection-probability").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    const objectScale = hostRect.width / host.clientWidth;
    const compact = host.clientWidth < 640 || host.clientHeight < 400;
    const horizontalPadding = compact ? 18 : 24;
    const noteTop = compact ? 52 : 62;
    const noteHeight = compact ? 90 : 76;
    const panel = {
      left: hostRect.left + horizontalPadding * objectScale,
      right: hostRect.right - horizontalPadding * objectScale,
      top: hostRect.top + noteTop * objectScale,
      bottom: hostRect.top + (noteTop + noteHeight) * objectScale,
    };
    const labels = ["What:", "Read:", "Logic:"];
    const textElements = Array.from(host.querySelectorAll("svg text"));
    const matches = labels.map((label) => ({
      label,
      element: textElements.find((element) => element.textContent?.includes(label)),
    }));

    return {
      missing: matches.filter(({ element }) => !element).map(({ label }) => label),
      tops: matches.flatMap(({ element }) => element ? [Math.round(element.getBoundingClientRect().top)] : []),
      overflow: matches.flatMap(({ label, element }) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const outside = rect.left < panel.left - 1 || rect.right > panel.right + 1 || rect.top < panel.top - 1 || rect.bottom > panel.bottom + 1;
        return outside ? [{ label, panel, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }] : [];
      }),
    };
  });
}

export async function sankeyNodeColors(page) {
  return page.getByTestId("echarts-sankey-flow").locator("svg").evaluate((svg) =>
    [...svg.querySelectorAll("path")]
      .map((path) => path.getAttribute("fill"))
      .filter((fill) => fill && fill !== "none" && !fill.startsWith("url") && fill !== "rgb(0,0,0)"),
  );
}

export async function pipelineConnectorGeometry(page) {
  return page.locator(".flow-grid").evaluate((grid) => {
    const connector = grid.querySelector(".flow-connector").getBoundingClientRect();
    const markers = [...grid.querySelectorAll(".flow-step-node")].map((marker) => marker.getBoundingClientRect());
    return {
      connectorLeft: connector.left,
      connectorRight: connector.right,
      firstCenter: markers[0].left + markers[0].width / 2,
      lastCenter: markers.at(-1).left + markers.at(-1).width / 2,
    };
  });
}
