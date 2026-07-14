# Visual Verification

User-facing canvas changes should leave browser evidence, not just command
output.

## Browser Recording

Use:

```sh
npm run verify:proof
```

The helper starts the local Vite server, opens Chromium through Playwright, and
runs an asserted user journey across layout, multi-selection, history, View
management, presentation, responsive drawer/exit paths, shortcuts, the shared
artifact library, drag, resize, pan, zoom, data, theme, Build Session creation,
deletion, re-addition, and close/reopen persistence. A verification-only
cursor and step label make each gesture legible in the recording. It launches a
  local relay emulator, copies a capability-free brief while verification is
  pending, upgrades it to live delivery in the same conversation, delivers two encrypted bundles
with the skill script, checks the pinned skill and launcher-integrity handoff,
and visibly rejects a mixed invalid selection without a partial install. The
handoff parser and delivery invocation include the protocol-v2 target View
incarnation; artifact bundles themselves remain schema version 1. The helper
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
- Build Session verification blocking the initial build brief, exposing a relay
  capability before session creation, failing to upgrade existing work when live
  delivery becomes ready, omitting the skill/delivery command, silently changing
  its target view, or changing board state before a delivery;
- Turnstile using the wrong theme or fixed width, visually dominating the modal,
  overlapping the build brief at short landscape heights, or trapping keyboard
  focus away from build, file-install, retry, and close actions;
- a closed but active Build Session losing its visible target/Open/End strip,
  transport state contradicting the delivery outcome, or rejection detail being
  clipped;
- an offline bundle installed after navigation silently changing the current
  View, omitting its original destination, or lacking an explicit **Open** path;
- trusted module preparation making the canvas inert, a deliberately delayed
  atomic commit making it inert without a visible **Installing delivery…**
  progress state, or closing Build with AI from a phone-width Artifact drawer
  failing to restore focus to the visible toggle;
- multi-artifact relay delivery appearing partially, overlapping a delivered or
  existing card while expanding beyond a full viewport, or showing a rejected
  selection on the canvas;
- Views or Artifacts shortcuts firing inside editable controls;
- downward View ordering doing nothing, deletion Undo restoring a stale save, or
  phone drawers/presentation losing focus containment or a pointer-accessible
  exit;
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

- Add perceptual frame-diff checks for one-frame UI regressions beyond the
  current blank-frame detector.
- Add visible-latency metrics for drag and zoom.
- Add production preview proof after `npm run build`.
- Add dedicated touch-gesture proof once direct touch manipulation is
  implemented; the current responsive proof covers visible controls and exits.
