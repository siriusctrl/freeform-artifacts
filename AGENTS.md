# AGENTS.md

This file is the operating map for agents working in this repo. Keep product
vision in `README.md` and durable tradeoffs in `docs/`; keep this file focused
on navigation, invariants, verification, and handoff rules.

## Source Map

- `src/App.tsx`: app orchestration only.
- `src/canvas/CanvasWorkspace.tsx`: active-view state and composition; delegates
  interaction, runtime loading, persistence, and node creation to focused modules.
- `src/canvas/components/`: canvas UI pieces.
- `src/canvas/components/AgentHandoffDialog.tsx`: the copyable agent-neutral
  artifact handoff; it must not mutate the board.
- `src/canvas/components/CanvasSidebar.tsx`: named view navigation and
  data-derived board previews; it must not execute artifact renderers.
- `src/canvas/components/ArtifactLibrary.tsx`: right-side Built-in/Yours catalog
  UI with click and drag placement; it must not own package persistence.
- `src/canvas/components/ArtifactPreview.tsx`: visibility-managed, contained
  live catalog thumbnails; it must release offscreen renderer lifecycles.
- `src/canvas/artifactCatalog.ts`: maps built-in presets and installed bundles
  into reusable, view-independent catalog entries.
- `src/canvas/hooks/useCanvasInteractions.ts`: drag, resize, pan, zoom, snap,
  marquee selection, group movement, and z-order interaction mechanics.
- `src/canvas/hooks/useCanvasDocumentHistory.ts`: bounded session history and
  pointer-gesture transaction boundaries.
- `src/canvas/hooks/useCanvasSelectionActions.ts`: selection layout, duplicate,
  clipboard, delete, Undo, and Redo commands.
- `src/canvas/selection.ts`: pure selection geometry, cloning, layout, and
  presentation Fit All math.
- `src/canvas/hooks/useCanvasShortcuts.ts`: guarded global canvas shortcuts;
  editable controls and modal workflows remain exempt.
- `src/canvas/board.ts`: serializable board schema and legacy persistence
  migration.
- `src/canvas/nodeSize.ts`: artifact minimum-size resolution and workspace
  normalization.
- `src/workspaces/`: published templates, IndexedDB/localStorage persistence,
  and workspace bundle import/export.
- `src/relay/`: browser Build Session lifecycle, AES-GCM protocol helpers,
  hibernating WebSocket client, atomic multi-bundle install, receipts, and
  host-owned placement.
- `relay/`: independently deployed Cloudflare Worker, SQLite Durable Object,
  Wrangler config, generated bindings, and emulator tests.
- `src/workspaces/useWorkspaceAutosave.ts`: debounced saves, close-time recovery,
  and save status transitions.
- `src/workspaces/preview.ts`: strips boards down to navigation-safe preview
  geometry.
- `src/canvas/debugState.ts`: Playwright/browser debug state only.
- `src/canvas/seeds/demoBoard.ts`: default demo board nodes.
- `src/lib/geometry.ts`: viewport math and screen/world coordinate conversion.
- `src/artifacts/types.ts`: artifact contract.
- `src/artifacts/chartKit.ts`: declarative Cartesian Chart Kit compiler,
  capability manifest, and raw ECharts capability guard.
- `src/artifacts/ChartKitArtifactHost.tsx`: adapts Chart Kit specs to the
  managed ECharts host.
- `src/artifacts/ArtifactContent.tsx`: shared validated renderer surface used by
  canvas nodes and Artifact Library previews.
- `src/artifacts/core/`: platform-provided artifacts.
- `src/artifacts/examples/`: demo and verification artifacts.
- `src/artifacts/generated/`: AI/user-generated repo-compiled artifact entry
  point.
- `src/artifacts/useArtifactRuntime.ts`: partial-failure loading for external and
  browser-installed artifact registries.
- `src/artifacts/ArtifactErrorBoundary.tsx`: per-node renderer isolation.
- `public/artifacts/generated/manifest.json`: trusted runtime ESM artifact
  manifest.
- `src/data/transforms.ts`: data shaping before render.
- `src/styles.css` and `src/styles/`: product styling entry point and domain
  styles.
- `tests/canvas.spec.ts`: Playwright interaction smoke test.
- `tests/relay.spec.ts`: real-browser relay, multi-delivery, atomicity,
  target-binding, idempotency, placement, and reconnect journeys.
- `tests/persistence.spec.ts`: multi-tab revision, fallback recovery,
  delete/restore, and zero-View race regressions.
- `tests/productivity.spec.ts`: multi-select/history, View management, and
  presentation-mode journeys.
- `scripts/`: preview and proof verification.
- `skill/freeform-artifact-builder/`: project-local artifact authoring skill.
- `skill/freeform-artifact-builder/references/visual-style-guide.md`: required
  hierarchy, spacing, chart color, and light/dark design rules.

## Engineering Invariants

- Keep `App.tsx` thin; put canvas mechanics under `src/canvas/`.
- Keep the first screen canvas-first, not dashboard-first.
- Keep viewport state separate from node world coordinates.
- Keep presentation framing derived from node bounds; never persist it over the
  user's editable viewport.
- Record completed node mutations, not pointer-move frames. Pan, zoom, theme,
  and transient selection are not history commands.
- Keep ordinary blank-stage drag as pan; `Shift+drag` owns marquee selection.
- Keep canvas state serializable.
- Treat published templates as immutable seeds; user edits belong to local
  workspaces.
- Preserve the legacy `templateId` storage key as the local view id; do not
  expose that historical naming in product UI.
- Generated artifacts must not mutate canvas state directly.
- Build with AI is a roughly 30-minute, explicit-consent session. Trusted
  packages install into IndexedDB and the session's immutable target local view
  without a repository change; do not add a confirmation per delivery.
- Artifact delivery mode must stay explicit: in-product Build with AI produces a
  Browser Relay handoff; offline file transfer uses Browser View Bundle;
  self-deployed work belongs in `src/artifacts/generated/*.artifact.tsx`.
- Prefer Chart Kit for ordinary bar, line, and combo charts. Raw ECharts is a
  registered-capability escape hatch, not the default generated interface.
- Runtime package ids are immutable across the browser origin; package and view
  writes must remain atomic, while node placement stays view-scoped.
- Relay installation must atomically write every selected package, the target
  workspace, and its successful delivery receipt. ACK loss must replay the
  receipt, never place another node.
- Relay installation must respect deleted-view tombstones. A delivery racing a
  View deletion is rejected and must never clear the tombstone or resurrect the
  target View.
- Keep browser and uploader capabilities separate, store only hashes in the
  relay, keep the AES-GCM key out of the Worker, bind the session to its original
  view, and never put capabilities in URLs, logs, or persisted bundle source.
- The relay remains ephemeral transport: no canvas/package state and no D1, KV,
  or R2 without a new accepted architecture decision.
- Deleting a canvas node must not delete its reusable personal package. The
  Artifact Library is origin-scoped and shared across local views, while a
  catalog placement remains ordinary view-scoped node state.
- Keep Build with AI agent-neutral. Its copied prompt installs the skill first,
  then asks the agent to question the user about the requested artifact.
- View thumbnails are geometry summaries, not cached screenshots or a second
  artifact rendering runtime.
- View ordering is browser-local navigation metadata. Duplicated views reuse
  package identities, and deleting a view must not delete artifact packages.
- Active-view duplicate/delete actions must use the live workspace snapshot,
  not a potentially stale debounced save. Deleted-view tombstones must keep a
  failed IndexedDB deletion from resurfacing later.
- Workspace revisions are compare-and-swap tokens. Keep autosaves single-flight,
  recovery mirrors monotonic, deletion tombstones unique per deletion, and
  restores conditional on that generation; never turn a conflict into a blind
  localStorage overwrite.
- Flush current-tab dirty state before a live relay or offline package commit.
  Relay merges against the transaction's latest persisted revision and must
  remain one reversible history entry without undoing sibling-tab changes.
- Keep mounted editing surfaces inert from the pre-install flush through
  applying its atomic commit, and cancel an active drag at that boundary; relay
  session controls must remain available to abort the operation.
- The fixed development Turnstile token is emulator-only: both the browser
  origin and the Worker's actual request URL must be loopback.
- Responsive drawers and presentation mode must retain a pointer-accessible
  exit path; keyboard shortcuts are accelerators, not the only escape route.
- Artifact Library thumbnails use the real trusted renderer and preset payload,
  scale the complete default-size node with contain semantics, disable preview
  animation/interaction, remain keyboard-inert, and mount only near the
  library scroller's visible range.
- Database shaping belongs in transforms, not render components.
- ECharts lifecycle stays inside `EChartsArtifactHost`.
- Dense artifacts declare `minSize`; essential labels must fit at both default
  and minimum dimensions.
- Prefer Chart Kit artifacts for standard charts; use managed raw ECharts only
  for registered capabilities that Chart Kit cannot express.
- Use custom React artifacts for visuals or interactions ECharts cannot express
  cleanly.
- Runtime external artifacts are trusted self-hosted code, not sandboxed
  plugins.
- Keep custom lifecycle-heavy artifacts trusted and compiled until a sandbox is
  implemented.
- Prefer typed interfaces before adding new runtime behavior.
- Keep product prose on Instrument Sans and reserve Geist Mono for numbers,
  dates, quarters, axes, and identifiers that benefit from fixed widths.
- Keep the top bar compact: secondary actions belong in More, not as additional
  top-level pills.
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
- Relay changes must also cover `npm run relay:test`, the `tests/relay.spec.ts`
  real-browser journey, `npm run relay:check`, and a deployed `/health` plus
  production Build Session smoke.
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
