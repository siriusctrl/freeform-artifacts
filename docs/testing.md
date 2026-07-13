# Testing Matrix

Verification is layered. Do not treat one layer as proof for the others.

## Static Checks

Run:

```sh
npm run check
```

This executes frontend TypeScript checking and a Vite production build, verifies
generated Wrangler bindings, type-checks and dry-runs the relay Worker, and runs
the local Worker/Durable Object suite. It catches type, module, protocol, and
bundling errors. It does not prove browser interaction behavior.

`npm run verify:preview` additionally builds and serves the production
`/freeform-artifacts/` base path, including the base-aware generated artifact
manifest and runtime module.

## Browser Smoke

Run:

```sh
npm run verify:ui
```

This starts the Vite dev server and uses Playwright Chromium to verify:

- the canvas renders;
- the initial artifact nodes are visible;
- dragging a card changes its world coordinates;
- default snap-to-grid is on and dragged nodes land on grid multiples;
- dragging a card does not create a browser text selection;
- dragging empty canvas space changes the viewport offset;
- the visual grid follows viewport pan and zoom instead of staying fixed to the
  browser glass;
- ordinary wheel input pans on both axes without changing zoom scale;
- a sequence of high-resolution browser pinch deltas changes zoom scale around
  the pointer with a responsive magnitude;
- pointer-anchored pinch zoom preserves the same world point with the Views
  sidebar both closed and open;
- zoom controls change zoom scale;
- resize handles change card dimensions;
- managed chart labels stay inside their SVG host at default and artifact
  minimum sizes;
- artifact-specific minimum dimensions are enforced during resize;
- imported legacy workspaces with undersized charts are normalized to current
  artifact minimums;
- the labeled snap-to-grid menu setting visibly switches from On to Off and
  back again;
- the compact top bar keeps its 54px frame and deliberate 30/34/38px tool,
  status, and command hierarchy;
- save status occupies a fixed-width slot before Theme/More, and Saving/Saved
  text changes do not move Theme, More, or Build;
- Instrument Sans is applied to product chrome while Geist Mono remains scoped
  to data-oriented text;
- the More icon is centered on both axes;
- a real resize-handle drag preserves artifact aspect ratio while the ECharts
  client width remains fixed and its screen width, labels, and selected-card
  controls all follow one object scale;
- canvas zoom then applies the same second scale to the complete node;
- theme toggle switches light/dark mode;
- importing sample query rows runs transforms and updates artifacts;
- Build with AI creates a Turnstile-verified, target-view-bound session and an
  immediately copyable, agent-neutral Browser Relay instruction without changing
  board state until a delivery is installed;
- centered-title rename, smoothly animated Views navigation, data-derived
  previews, create/switch, and active-view reload recovery;
- guarded `Cmd/Ctrl+B`, `Shift+Cmd/Ctrl+A`, `Cmd/Ctrl+0`, zoom, Escape, and
  deletion shortcuts, including input-field exemption;
- Built-in artifact search, visible-viewport click placement, and drag placement
  with world-coordinate conversion and grid snap;
- complete contained live previews for all built-in renderer families, personal
  bundle previews, inert preview controls, scroller-relative offscreen lifecycle
  release, dual-theme rendering, and mobile panel geometry without horizontal
  overflow;
- personal package survival after node deletion, reuse from Yours across local
  views, reload recovery, and isolation between browser contexts;
- Agent API and file-fallback bundle installation plus registry/node recovery
  after reload;
- Browser bundle capability discovery and non-persisting Chart Kit preflight at
  default/minimum size in both themes;
- Build with AI prompt selection of Browser Relay delivery, including reusable
  session-scoped upload capability, multi-bundle command, fixed target view, and
  the prohibition on self-deployed source files;
- encrypted multi-artifact delivery, repeat deliveries in one session, local
  script interoperability, grid snap/highest-z placement, and centered
  grid-offset fallback when no complete viewport opening exists;
- all-or-nothing browser validation for a bad multi-artifact selection, target
  binding after view navigation, pending replay after disconnect, and receipt
  replay without duplicate placement when a post-commit ACK is lost;
- one broken runtime renderer stays isolated to its card, package id collisions
  are rejected, invalid target views leave no package behind, and one corrupt
  installed package does not suppress healthy runtime artifacts;
- board-data import rejects references to unavailable executable packages before
  changing the current view;
- default examples hide internal implementation labels and keep simplified
  hierarchy at their authored sizes;
- the Pipeline connector endpoints align with the first and last marker centers
  within one rendered pixel;
- ECharts labels remain contained and categorical node palettes contain the
  intended distinct colors in both light and dark mode;
- published-example migrations refresh known demo payloads without restoring a
  deleted node or changing its saved position;
- title-bar, `Delete`, and `Backspace` deletion paths remove only the selected
  artifact and persist the removal;
- IndexedDB restores the workspace after reload, while the page-close recovery
  mirror preserves a change even when the debounced save has not fired yet;
- two independent browser contexts receive separate local forks and cannot see
  each other's deletions;
- the debug state reports the active template ID and storage mode.

The browser suites live under `tests/`; `canvas.spec.ts` intentionally follows
end-to-end user journeys, while helpers should move out when they are reused by
another suite rather than solely to satisfy a line-count target.
`tests/mobile.spec.ts` keeps the touch-sized layout honest without pretending
desktop mouse gestures are touch interaction coverage.

## Relay Emulator and Adversarial Coverage

Run the transport suite alone with:

```sh
npm run relay:check
npm run relay:test
```

`relay:test` uses the Workers Vitest pool and real local Durable Objects. It
checks strict CORS, 30-minute alarms, separate browser/upload capabilities,
WebSocket hibernation/replay, terminal ACK deletion, idempotency, capability
substitution attempts, signed-locator forgery, changed-envelope delivery-id
conflicts, invalid-token rate-limit isolation, fail-closed environment drift,
malformed and oversized bodies, cross-origin uploads, session delivery ceilings,
cleanup/upload races, and refusal after cleanup. `relay:check` also proves
that committed Wrangler-generated types are current and that the production
bundle/migration can be produced with `wrangler deploy --dry-run`.

`tests/relay.spec.ts` launches the same local Worker/DO emulator and a real
Chromium page. Its Turnstile stub uses Cloudflare's documented development test
key/token only; production verification must use the real widget and siteverify.
The browser suite also covers rapid deliveries across current persisted state,
same-view multi-tab edits during a relay commit, page-memory-only capabilities,
cancellation during module preparation, stale view creation responses,
authenticated byte-identical uploader retry caching, and ambiguous network
outcomes that preserve the original delivery id.

If Chromium is missing, run:

```sh
npm run setup:browsers
```

## Browser Proof

Run:

```sh
npm run verify:proof
```

This is the visual evidence path. It opens Chromium and runs a complete asserted
journey through layout, drag, resize, pan, pinch in/out, toolbar zoom/reset, data
import, theme switching, Build Session creation, encrypted multi-artifact relay
delivery, atomic bad-selection rejection, artifact deletion, and persistence
after reopening. It
records WebM video with a verification-only cursor and step label, writes a
final screenshot, converts the recording to GIF with `ffmpeg`, writes a 30-cell
contact sheet sampled across the full timeline, runs a blank-frame check, and
saves structured UX checks plus a manifest.

This is the browser equivalent of a PTY visual smoke test. It proves the app can
be operated through a real browser, not just through static tests.

## What To Inspect

After a user-facing visual change:

1. Run `npm run check`.
2. Run `npm run verify:ui`.
3. Run `npm run verify:preview`.
4. Run `npm run verify:proof`.
5. Inspect `artifacts/verification/<timestamp>/proof.gif`.
6. Inspect `contact-sheet.png` to catch temporal flicker or hover artifacts that
   a final screenshot can miss.
7. Inspect `ux-checks.json` and confirm every journey checkpoint passed.
8. Inspect `frame-check.json` for sampled frame statistics.
9. Inspect `final-screenshot.png` only as a supplementary static check.
10. Report the absolute proof directory path in the handoff.

## Test Boundaries

The current smoke test is intentionally narrow. Add focused tests when changing:

- zoom math;
- pan behavior;
- node drag behavior;
- resize handles;
- artifact registry loading;
- data transform behavior;
- serialization;
- relay protocol versioning, capabilities, encryption, idempotency receipts,
  expiry, rate/size ceilings, reconnect, and target-view placement;
- template forking and workspace migration;
- IndexedDB failure fallback and workspace bundle import/export;
- production preview behavior;
- sandboxing;
- visual proof artifact shape.
