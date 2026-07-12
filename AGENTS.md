# AGENTS.md

This file is the operating map for agents working in this repo. Keep product
vision in `README.md` and durable tradeoffs in `docs/`; keep this file focused
on navigation, invariants, verification, and handoff rules.

## Source Map

- `src/App.tsx`: app orchestration only.
- `src/canvas/components/`: canvas UI pieces.
- `src/canvas/components/AgentHandoffDialog.tsx`: the copyable agent-neutral
  artifact handoff; it must not mutate the board.
- `src/canvas/components/CanvasSidebar.tsx`: named view navigation and
  data-derived board previews; it must not execute artifact renderers.
- `src/canvas/hooks/useCanvasInteractions.ts`: drag, resize, pan, zoom, snap,
  and z-order interaction mechanics.
- `src/canvas/board.ts`: serializable board schema and legacy persistence
  migration.
- `src/canvas/nodeSize.ts`: artifact minimum-size resolution and workspace
  normalization.
- `src/workspaces/`: published templates, IndexedDB/localStorage persistence,
  and workspace bundle import/export.
- `src/workspaces/preview.ts`: strips boards down to navigation-safe preview
  geometry.
- `src/canvas/debugState.ts`: Playwright/browser debug state only.
- `src/canvas/seeds/demoBoard.ts`: default demo board nodes.
- `src/lib/geometry.ts`: viewport math and screen/world coordinate conversion.
- `src/artifacts/types.ts`: artifact contract.
- `src/artifacts/core/`: platform-provided artifacts.
- `src/artifacts/examples/`: demo and verification artifacts.
- `src/artifacts/generated/`: AI/user-generated repo-compiled artifact entry
  point.
- `public/artifacts/generated/manifest.json`: trusted runtime ESM artifact
  manifest.
- `src/data/transforms.ts`: data shaping before render.
- `src/styles.css` and `src/styles/`: product styling entry point and domain
  styles.
- `tests/canvas.spec.ts`: Playwright interaction smoke test.
- `scripts/`: preview and proof verification.
- `skill/freeform-artifact-builder/`: project-local artifact authoring skill.
- `skill/freeform-artifact-builder/references/visual-style-guide.md`: required
  hierarchy, spacing, chart color, and light/dark design rules.

## Engineering Invariants

- Keep `App.tsx` thin; put canvas mechanics under `src/canvas/`.
- Keep the first screen canvas-first, not dashboard-first.
- Keep viewport state separate from node world coordinates.
- Keep canvas state serializable.
- Treat published templates as immutable seeds; user edits belong to local
  workspaces.
- Preserve the legacy `templateId` storage key as the local view id; do not
  expose that historical naming in product UI.
- Generated artifacts must not mutate canvas state directly.
- Build with AI is bundle-first: trusted packages install into IndexedDB and a
  target local view without a repository change.
- Keep Build with AI agent-neutral. Its copied prompt installs the skill first,
  then asks the agent to question the user about the requested artifact.
- View thumbnails are geometry summaries, not cached screenshots or a second
  artifact rendering runtime.
- Database shaping belongs in transforms, not render components.
- ECharts lifecycle stays inside `EChartsArtifactHost`.
- Dense artifacts declare `minSize`; essential labels must fit at both default
  and minimum dimensions.
- Prefer managed ECharts artifacts for standard charts.
- Use custom React artifacts for visuals or interactions ECharts cannot express
  cleanly.
- Runtime external artifacts are trusted self-hosted code, not sandboxed
  plugins.
- Keep custom lifecycle-heavy artifacts trusted and compiled until a sandbox is
  implemented.
- Prefer typed interfaces before adding new runtime behavior.
- Artifact review must inspect both light and dark mode. ECharts artifacts must
  theme titles, axes, legends, annotations, tooltips, marks, nodes, links, and
  emphasis states rather than inheriting library defaults.
- Do not expose internal data names or retain counters, badges, nested panels,
  and decorative rails that do not improve interpretation.

## Verification

- Run `npm run check` for every code change.
- Run `npm run verify:ui` for interaction or rendering changes.
- Run `npm run verify:preview` for runtime, bundling, import, persistence, or
  production-facing changes.
- Persistence changes must prove close/reopen recovery and isolation between
  two Playwright browser contexts.
- Run `npm run verify:proof` for user-facing visual changes.
- Inspect `proof.gif`, every cell in `contact-sheet.png`, `ux-checks.json`, and
  `frame-check.json` before claiming visual behavior works.
- The GIF must visibly exercise every changed user-facing function with a named
  step, real input, readable before/after states, and enough dwell time to judge
  the result. Hidden assertions alone are not proof.
- Report the absolute proof GIF path in the final handoff when visual behavior
  changed.
- If Chromium is missing, run `npm run setup:browsers` and retry.
- If GIF generation fails, check that `ffmpeg` is available.

## Docs Update Rules

- User-visible behavior or commands: update `README.md` and `CHANGELOG.md`.
- Runtime, artifact, data, or canvas boundary: update `docs/architecture.md`.
- Significant decision or rejected alternative: update
  `docs/architecture-decisions.md`.
- Verification commands or coverage: update `docs/testing.md`.
- Proof artifact shape or review workflow: update `docs/visual-verification.md`.
- Artifact contract, renderer policy, layout expectations, or proof
  requirements: update `skill/freeform-artifact-builder/`.

## Commit Rules

- Use Conventional Commits.
- Include a body that explains what changed and why.
- Do not revert unrelated user changes.
