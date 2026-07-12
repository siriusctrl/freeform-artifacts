# Testing Matrix

Verification is layered. Do not treat one layer as proof for the others.

## Static Checks

Run:

```sh
npm run check
```

This executes TypeScript checking and a Vite production build. It catches type,
module, and bundling errors. It does not prove interaction behavior.

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
- zoom controls change zoom scale;
- resize handles change card dimensions;
- managed chart labels stay inside their SVG host at default and artifact
  minimum sizes;
- artifact-specific minimum dimensions are enforced during resize;
- imported legacy workspaces with undersized charts are normalized to current
  artifact minimums;
- the labeled snap-to-grid menu setting visibly switches from On to Off and
  back again;
- Theme, More, saved status, and Build with AI share one top-level control
  height;
- the More icon is centered on both axes;
- a real resize-handle drag preserves artifact aspect ratio while the ECharts
  client width remains fixed and its screen width, labels, and selected-card
  controls all follow one object scale;
- canvas zoom then applies the same second scale to the complete node;
- theme toggle switches light/dark mode;
- importing sample query rows runs transforms and updates artifacts;
- Build with AI creates an immediately copyable, agent-neutral skill instruction
  that asks the agent to discover the artifact request without changing board
  state until a bundle is installed;
- centered-title rename, smoothly animated Views navigation, data-derived
  previews, create/switch, and active-view reload recovery;
- Agent API and file-fallback bundle installation plus registry/node recovery
  after reload;
- title-bar, `Delete`, and `Backspace` deletion paths remove only the selected
  artifact and persist the removal;
- IndexedDB restores the workspace after reload and after closing/reopening the
  page;
- two independent browser contexts receive separate local forks and cannot see
  each other's deletions;
- the debug state reports the active template ID and storage mode.

The main test lives in `tests/canvas.spec.ts`.
`tests/mobile.spec.ts` keeps the touch-sized layout honest without pretending
desktop mouse gestures are touch interaction coverage.

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
import, theme switching, AI handoff generation, artifact deletion, and
persistence after reopening. It
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
- template forking and workspace migration;
- IndexedDB failure fallback and workspace bundle import/export;
- production preview behavior;
- sandboxing;
- visual proof artifact shape.
