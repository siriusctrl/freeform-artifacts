# Visual Verification

User-facing canvas changes should leave browser evidence, not just command
output.

## Browser Recording

Use:

```sh
npm run verify:proof
```

The helper starts the local Vite server, opens Chromium through Playwright, and
runs an asserted user journey across layout, shortcuts, the shared artifact
library, drag, resize, pan, zoom, data, theme, AI handoff generation, deletion,
re-addition, and close/reopen persistence. A verification-only
cursor and step label make each gesture legible in the recording. The helper
captures video, converts it to GIF, and writes:

- `proof.gif` for quick user-facing review.
- `recording.webm` as the original Playwright recording.
- `final-screenshot.png` for static inspection.
- `contact-sheet.png` with 30 uniformly sampled cells for internal keyframe
  inspection across the complete GIF timeline.
- `frame-check.json` with sampled frame statistics for blank-like frame checks.
- `ux-checks.json` with the assertion result and details from every journey
  checkpoint.
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

Inspect the GIF and the full 30-cell `contact-sheet.png` before reporting
completion. Read `ux-checks.json`, the final screenshot, and `frame-check.json`
as supplementary checks. Look for:

- every changed user-facing function appearing as a named, legible action with
  real input and readable before/after dwell; an assertion that is invisible in
  the GIF does not count as proof;

- blank canvas on startup;
- missing cards;
- unexpected card clipping;
- zoom controls covering card content;
- card drag not moving the selected node;
- browser text selection appearing during card drag;
- canvas pan moving the wrong layer;
- trackpad scrolling moving in the wrong direction or changing scale;
- pinch zoom jumping away from the pointer;
- top toolbar zoom controls not changing scale;
- snap-to-grid toggle not returning to the intended on/off state;
- light/dark mode leaving illegible cards or panels;
- AI handoff accidentally changing board state or omitting the skill command;
- Views or Artifacts shortcuts firing inside editable controls;
- the Artifact Library covering its drag target, clipping on mobile, or losing
  personal packages when a node is deleted or the active view changes;
- Artifact Library previews showing a cropped card, stretching its aspect
  ratio, retaining offscreen chart instances, replaying distracting animation,
  or diverging from the corresponding canvas renderer;
- a selected-card delete control being hidden or deleting the wrong artifact;
- local save state failing to settle after an interaction;
- a restored workspace reverting to the published template;
- text overflow in buttons, cards, chart annotations, or Sankey labels;
- one-frame label jumps, tooltip flashes, hover highlights, or chart redraws
  that only appear during motion.

## Future Improvements

- Add frame-diff checks for blank frames.
- Add visible-latency metrics for drag and zoom.
- Add production preview proof after `npm run build`.
- Add mobile viewport proof once touch gestures are implemented.
