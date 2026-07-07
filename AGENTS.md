# AGENTS.md

Principles for agents contributing to this repository.

## Core Principles

1. **Canvas-first, not dashboard-first**
   - This project is a Freeform-style artifact canvas.
   - Do not turn the first screen into a landing page, admin dashboard, or
     server management console unless the product boundary is deliberately
     changed.

2. **Artifacts are registry objects**
   - AI-generated cards must enter through the artifact contract in
     `src/artifacts/types.ts`.
   - Do not let generated artifacts mutate canvas state directly.
   - Keep database transforms outside render components.
   - Prefer managed ECharts artifacts for standard charts.
   - Use custom React artifacts when ECharts cannot express the visual or
     interaction cleanly.

3. **DOM artifacts are intentional**
   - The current renderer uses React/DOM nodes inside a transformed world layer.
   - Do not replace the runtime with a pure `<canvas>` renderer unless the
     product goal shifts toward drawing primitives rather than data artifacts.

4. **Browser proof is required for user-facing interaction**
   - When canvas interaction, artifact rendering, layout, or visual behavior
     changes, run a real browser verification path before reporting completion.
   - Keep the proof GIF path in the final handoff.

5. **Conventional Commits with real bodies**
   - Use Conventional Commits for commits.
   - Include a body that explains what changed and why.

## Navigation

Use README for user-facing behavior. Use docs for maintainer workflows and
durable project decisions.

Keep this file coarse-grained. Do not mirror every implementation detail here.
Use `docs/INDEX.md` as the navigation entry point when you need code layout or
workflow-specific docs.

### Read these docs first

- `README.md`
- `docs/INDEX.md`
- `CHANGELOG.md`

### Read these docs when the task matches

- Architecture, canvas state, artifact runtime, data transforms, or renderer
  boundaries:
  - Read `docs/architecture.md`.
- Product and engineering tradeoffs, including accepted and rejected technical
  routes:
  - Read `docs/architecture-decisions.md`.
- Tests, Playwright setup, UI smoke coverage, or proof scripts:
  - Read `docs/testing.md`.
- Browser recordings, GIF evidence, screenshots, traces, or proof inspection:
  - Read `docs/visual-verification.md`.

## Engineering Rules

- Keep canvas state serializable.
- Keep viewport state separate from node world coordinates.
- Keep artifact definitions pure from canvas state mutations.
- Keep data transforms separate from artifact rendering.
- Keep ECharts lifecycle inside `EChartsArtifactHost`; generated ECharts
  artifacts should provide `buildOption`, data, config, and schema hints only.
- Keep ECharts artifacts non-interactive by default so canvas drag remains
  primary. Enable artifact-level interactivity only when the user needs chart
  hover, tooltip, click, or brush behavior.
- Keep custom lifecycle-heavy artifacts trusted and compiled until a sandbox is
  implemented.
- Prefer typed interfaces before adding new runtime behavior.
- Update `README.md` when user-visible behavior or commands change.
- Update `docs/architecture.md` when the artifact contract, data pipeline, or
  canvas runtime boundary changes.
- Update `docs/architecture-decisions.md` when choosing a significant library,
  runtime boundary, verification strategy, sandbox strategy, or rejected
  alternative.
- Update `docs/testing.md` when verification commands or test coverage changes.
- Update `docs/visual-verification.md` when proof artifact shape changes.
- Update `CHANGELOG.md` for user-facing behavior, verification workflows, or
  handoff policy changes.

## Verification Requirements

- Run `npm run check`.
- Run `npm run verify:ui` when interaction or rendering behavior changes.
- Run `npm run verify:proof` when a user-facing visual interaction changes.
- Inspect the generated GIF and contact-sheet keyframes yourself before
  reporting completion. Use the final screenshot only as a supplementary static
  check.
- Report the absolute path to the latest proof directory in the final summary.
- If Playwright cannot launch Chromium, run `npm run setup:browsers` and retry.
- If GIF generation fails, check that `/usr/bin/ffmpeg` or another `ffmpeg`
  binary is available.
- Do not claim a browser interaction works based only on static TypeScript or
  build success.
