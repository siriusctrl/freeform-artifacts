# Visual Verification

User-facing canvas changes should leave browser evidence, not just command
output.

## Browser Recording

Use:

```sh
npm run verify:proof
```

The helper starts the local Vite server, opens Chromium through Playwright,
performs a fixed interaction script, captures video, converts it to GIF, and
writes:

- `proof.gif` for quick user-facing review.
- `recording.webm` as the original Playwright recording.
- `final-screenshot.png` for static inspection.
- `contact-sheet.png` for internal keyframe inspection across the GIF timeline.
- `frame-check.json` with sampled frame statistics for blank-like frame checks.
- `manifest.json` with action list and final debug state.
- `inspection.txt` with a short human-readable checklist.

The output directory is:

```text
artifacts/verification/<timestamp>/
```

That directory is ignored by git. Keep the latest path in final summaries or
handoff notes when the visual behavior changed.

## Required Local Tools

- Node.js and npm.
- Playwright Chromium installed by `npm run setup:browsers`.
- `ffmpeg` available on `PATH`.

This server currently has `ffmpeg`; browser installation is project-local via
Playwright.

## Manual Review

Inspect the GIF and `contact-sheet.png` before reporting completion. Use the
final screenshot and `frame-check.json` as supplementary checks. Look for:

- blank canvas on startup;
- missing cards;
- unexpected card clipping;
- zoom controls covering card content;
- card drag not moving the selected node;
- browser text selection appearing during card drag;
- canvas pan moving the wrong layer;
- wheel zoom jumping away from the pointer;
- top toolbar zoom controls not changing scale;
- light/dark mode leaving illegible cards or panels;
- added artifacts appearing outside the visible canvas;
- text overflow in buttons, cards, or inspector panels.
- one-frame label jumps, tooltip flashes, hover highlights, or chart redraws
  that only appear during motion.

## Future Improvements

- Add frame-diff checks for blank frames.
- Add visible-latency metrics for drag and zoom.
- Add production preview proof after `npm run build`.
- Add mobile viewport proof once touch gestures are implemented.
