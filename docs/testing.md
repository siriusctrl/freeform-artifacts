# Testing Matrix

Verification is layered. Do not treat one layer as proof for the others.

## Static Checks

Run:

```sh
npm run check
```

This executes TypeScript checking and a Vite production build. It catches type,
module, and bundling errors. It does not prove interaction behavior.

## Browser Smoke

Run:

```sh
npm run verify:ui
```

This starts the Vite dev server and uses Playwright Chromium to verify:

- the canvas renders;
- the initial artifact nodes are visible;
- dragging a card changes its world coordinates;
- dragging a card does not create a browser text selection;
- dragging empty canvas space changes the viewport offset;
- wheel input changes zoom scale;
- zoom controls change zoom scale;
- theme toggle switches light/dark mode;
- adding an artifact inserts and selects a registry-backed node.

The main test lives in `tests/canvas.spec.ts`.

If Chromium is missing, run:

```sh
npm run setup:browsers
```

## Browser Proof

Run:

```sh
npm run verify:proof
```

This is the visual evidence path. It opens Chromium, performs the same class of
real mouse interactions, records WebM video, writes a final screenshot, converts
the recording to GIF with `ffmpeg`, and writes a manifest.

This is the browser equivalent of a PTY visual smoke test. It proves the app can
be operated through a real browser, not just through static tests.

## What To Inspect

After a user-facing visual change:

1. Run `npm run check`.
2. Run `npm run verify:ui`.
3. Run `npm run verify:proof`.
4. Inspect `artifacts/verification/<timestamp>/proof.gif`.
5. Inspect `final-screenshot.png` if the GIF is hard to judge.
6. Report the absolute proof directory path in the handoff.

## Test Boundaries

The current smoke test is intentionally narrow. Add focused tests when changing:

- zoom math;
- pan behavior;
- node drag behavior;
- resize handles;
- artifact registry loading;
- data transform behavior;
- serialization;
- sandboxing;
- visual proof artifact shape.
