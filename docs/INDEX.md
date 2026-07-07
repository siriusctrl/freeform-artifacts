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
  - production preview verification
  - Playwright smoke coverage
  - interaction assertions
  - local browser setup
- `docs/visual-verification.md`
  - browser proof recording
  - GIF output expectations
  - screenshot and manifest inspection
- `skill/freeform-artifact-builder/SKILL.md`
  - project-local skill for creating, registering, laying out, and verifying
    canvas artifacts
  - handoff evidence format

Code orientation:

- `src/main.tsx` mounts the React application.
- `src/App.tsx` owns the current demo canvas runtime, viewport state, node
  movement, resize behavior, zoom behavior, selection, persistence, and toolbar
  actions.
- `src/canvas/` contains board serialization, shared canvas constants, and node
  factories.
- `src/lib/geometry.ts` owns viewport math and screen/world coordinate
  conversion.
- `src/artifacts/types.ts` defines the artifact, canvas node, viewport, event,
  theme, and data binding interfaces.
- `src/artifacts/registry.ts` merges core, example, and generated artifact
  registries.
- `src/artifacts/core/` contains platform-provided artifact modules.
- `src/artifacts/examples/` contains demo and verification artifact modules.
- `src/artifacts/generated/` is the reserved entry point for future user or
  AI-generated artifacts.
- `src/canvas/seeds/demoBoard.ts` defines the default demo board nodes.
- `src/data/sampleDatabase.ts` contains sample database rows.
- `src/data/transforms.ts` contains transform registry entries.
- `src/data/transformFixtures.ts` contains raw query-result fixtures.
- `src/styles.css` owns the current product UI styling.
- `tests/canvas.spec.ts` drives a real Chromium browser and asserts core
  canvas interactions.
- `scripts/record-proof.mjs` records the browser proof WebM, converts it to
  GIF, and writes manifest, screenshot, contact-sheet, frame-check, and inspection
  artifacts.
- `scripts/verify-preview.mjs` verifies the production build through Vite
  preview and Chromium.
- `skill/freeform-artifact-builder/` contains the project-local Codex skill and
  references for future artifact-building agents.

Keep README user-facing. Keep maintainer-only workflows in docs and link them
from `AGENTS.md`.
