# Docs Index

Read in this order when getting oriented:

1. `README.md`
2. `AGENTS.md`
3. `CHANGELOG.md`

Read these when the task matches:

- `docs/architecture.md`
  - product boundary
  - canvas state model
  - artifact registry
  - data transform pipeline
  - AI artifact contract
  - renderer lifecycle
- `docs/architecture-decisions.md`
  - accepted technical decisions
  - rejected alternatives
  - tradeoffs and follow-up triggers
- `docs/testing.md`
  - TypeScript/build verification
  - Playwright smoke coverage
  - interaction assertions
  - local browser setup
- `docs/visual-verification.md`
  - browser proof recording
  - GIF output expectations
  - screenshot and manifest inspection
  - handoff evidence format

Code orientation:

- `src/main.tsx` mounts the React application.
- `src/App.tsx` owns the current demo canvas runtime, viewport state, node
  movement, zoom behavior, selection, and toolbar actions.
- `src/lib/geometry.ts` owns viewport math and screen/world coordinate
  conversion.
- `src/artifacts/types.ts` defines the artifact, canvas node, viewport, event,
  theme, and data binding interfaces.
- `src/artifacts/registry.ts` registers available artifact definitions and
  initial canvas nodes.
- `src/artifacts/MetricCard.tsx`, `TablePreview.tsx`, `FlowDiagram.tsx`,
  `InflectionProbability.tsx`, and `SankeyFlow.tsx` are example artifact
  modules.
- `src/data/sampleDatabase.ts` contains sample database rows and transform
  helpers.
- `src/styles.css` owns the current product UI styling.
- `tests/canvas.spec.ts` drives a real Chromium browser and asserts core
  canvas interactions.
- `scripts/record-proof.mjs` records the browser proof WebM, converts it to
  GIF, and writes manifest, screenshot, contact-sheet, and inspection
  artifacts.

Keep README user-facing. Keep maintainer-only workflows in docs and link them
from `AGENTS.md`.
