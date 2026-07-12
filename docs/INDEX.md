# Docs Index

Read in this order when getting oriented:

1. `README.md`
2. `AGENTS.md`
3. `CHANGELOG.md`

Use `AGENTS.md` as the compact operating map for agents. Product framing lives
in `README.md`; durable architecture rationale lives in `docs/architecture.md`
and `docs/architecture-decisions.md`.

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
- `src/App.tsx` owns view bootstrap/switching, persistence, runtime artifact
  installation, import/export, theme, snap preference, and deletion.
- `src/canvas/components/` contains the toolbar, default-collapsed view sidebar,
  AI handoff dialog, board, node, and zoom controls.
- `src/canvas/hooks/useCanvasInteractions.ts` owns pan, zoom, drag, resize, and
  snap interaction mechanics.
- `src/canvas/nodeSize.ts` enforces artifact minimums for live resize, loaded
  workspaces, and imported backups.
- `src/canvas/debugState.ts` publishes the browser-verification debug handle.
- `src/canvas/` also contains board serialization and shared canvas constants.
- `src/workspaces/` owns immutable templates, local persistence, recovery
  fallback, and portable workspace bundles.
- `src/workspaces/preview.ts` creates lightweight geometry summaries for the
  Views sidebar without mounting artifact renderers.
- `src/lib/geometry.ts` owns viewport math and screen/world coordinate
  conversion.
- `src/artifacts/types.ts` defines the artifact, canvas node, viewport, event,
  theme, and data binding interfaces.
- `src/artifacts/registry.ts` merges core, example, and generated artifact
  registries.
- `src/artifacts/core/` contains platform-provided artifact modules.
- `src/artifacts/examples/` contains demo and verification artifact modules.
- `src/artifacts/generated/bundles.ts` validates, loads, and persists trusted
  personal artifact bundles installed through the browser Agent API or file
  fallback.
- `src/artifacts/generated/` also remains the entry point for shared,
  repo-compiled artifacts.
- `public/artifacts/generated/manifest.json` lists trusted runtime ESM
  artifacts loaded without rebuilding the main app.
- `src/canvas/seeds/demoBoard.ts` defines the default demo board nodes.
- `src/data/sampleDatabase.ts` contains sample database rows.
- `src/data/transforms.ts` contains transform registry entries.
- `src/data/transformFixtures.ts` contains raw query-result fixtures.
- `src/styles.css` imports domain styles from `src/styles/`.
- `tests/canvas.spec.ts` drives a real Chromium browser and asserts core
  canvas interactions.
- `scripts/record-proof.mjs` records the browser proof WebM, converts it to
  GIF, asserts a complete UX journey, and writes manifest, screenshot,
  contact-sheet, UX-check, frame-check, and inspection artifacts.
- `scripts/verify-preview.mjs` verifies the production build through Vite
  preview and Chromium.
- `scripts/lib/` contains shared browser-server helpers for verification
  scripts.
- `skill/freeform-artifact-builder/` contains the project-local Codex skill and
  references for future artifact-building agents.
- `skill/freeform-artifact-builder/references/artifact-bundle.md` defines the
  no-commit personal bundle contract and installation routes.

Keep README user-facing. Keep maintainer-only workflows in docs and link them
from `AGENTS.md`.
