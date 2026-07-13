# Changelog

All notable user-facing changes to this project should be documented here.

## 0.1.0 - Unreleased

### Added

- Initial React/TypeScript/Vite freeform artifact canvas.
- DOM-based artifact nodes with pan, zoom, drag, selection, resize, and deletion
  interactions.
- Light/dark mode support.
- Artifact contract and registry with metric, table, and flow-diagram examples.
- Managed ECharts artifact host for standard chart artifacts.
- Probability chart and Sankey examples backed by ECharts options.
- Self-hosted Instrument Sans interface typography and Geist Mono data
  typography.
- Sample database rows and transform helpers.
- Published template forking into per-browser IndexedDB workspaces.
- Synchronous localStorage recovery mirrors for close/reopen resilience.
- Versioned board-data JSON import/export and explicit reset-to-demo control.
- Default-on 38px snap-to-grid placement with a toolbar setting.
- Selected-card resize handles.
- Selected-artifact deletion from the title bar and with `Delete`/`Backspace`.
- Transform registry with checked raw-row fixtures.
- Zod-backed artifact payload validation with invalid-artifact fallback UI.
- Playwright browser smoke test for core canvas interactions.
- Production build preview verification.
- Browser proof recorder that writes WebM, GIF, screenshot, manifest, and
  inspection artifacts.
- Internal proof contact sheet generation for keyframe inspection.
- Lightweight proof frame checks for blank-like sampled frames.
- README, AGENTS, architecture, testing, and visual-verification handoff docs.
- Project-local `freeform-artifact-builder` skill for future agents creating
  compliant artifacts and canvas layouts.
- Layered artifact directories and registries for core, examples, and generated
  artifacts.
- Auto-discovery for repo-generated `*.artifact.tsx` modules.
- Trusted runtime ESM artifact loading through
  a base-aware `artifacts/generated/manifest.json`.
- GitHub Pages deployment under `/freeform-artifacts/`.
- Mobile-first template framing that opens the primary chart at a useful scale.
- Multiple named browser-local canvas views with a collapsed sidebar and
  centered inline title editing.
- Trusted artifact bundles persisted in IndexedDB, with direct Agent API and
  file-import installation paths that require no app commit or deployment.
- Agent-neutral **Build with AI** handoff that installs the project skill before
  asking the agent to clarify what artifact the user wants.
- Smooth **Views** sidebar transitions and data-derived canvas previews beneath
  each view name.
- Polished default examples: removed the internal table name, simplified the
  artifact pipeline, generalized supply copy, and added distinct light/dark
  Sankey node palettes.
- Artifact skill visual style guide with mandatory dual-theme chart and browser
  verification rules.
- Published-example migration that refreshes the three shared demo payloads in
  existing local forks while preserving personal layout, deletions, and added
  artifacts.
- Compact 54px top bar with a grouped display control, flat save state, and
  restrained command button hierarchy.
- Runtime artifact definition validation, per-card render isolation, immutable
  package identities, atomic view installation, and partial-failure loading.
- Debounced and per-view ordered workspace saves with page-close recovery.
- Pull-request browser verification in GitHub Actions.
- Declarative Chart Kit v1 for managed bar, line, and combo charts, including
  dataset encoding, shared visual tokens, ARIA, and strict capability checks.
- Non-persisting `validateArtifact()` and browser-visible renderer capabilities
  for agent bundle preflight.
- Explicit Browser View Bundle versus Self-Deployed Repo workflows in the
  project skill and Build with AI handoff.
- Shared Artifact Library with Built-in/Yours tabs, search, click placement,
  drag-to-canvas placement, and personal package reuse across local views.
- Canvas shortcuts for Views, Artifacts, viewport reset, zoom, Escape, and
  deletion with editable-field and modal guards.

### Fixed

- Aligned the Pipeline connector and stage markers to one shared grid geometry
  so the line remains continuous through all three stages.
- Centered the More icon without relying on inline-button baseline layout.
- Replaced textual snap state with a compact, accessible switch labeled
  `Snap to grid`.
- Replaced responsive frame resizing with aspect-locked whole-object scaling:
  artifact content, chrome, Delete, and resize controls now share one local
  scale before the outer canvas zoom is applied.
- Made browser proof journeys visibly demonstrate every changed product
  function instead of relying on hidden structured assertions alone.
- Moved snap-to-grid into a labeled More-menu setting with immediate On/Off
  feedback.
- Split probability chart guidance into three independently positioned SVG
  lines so What, Read, and Logic remain inside the note panel.
- Replaced domain-specific demo wording with a generic supply and allocation
  scenario.
- Reflowed managed ECharts options from live content-box dimensions so
  probability markers and Sankey labels stay inside their hosts.
- Added artifact-specific minimum resize dimensions for dense charts.
- Normalized older browser workspaces and imported backups that contain chart
  sizes below the registered artifact minimum.
- Made ordinary trackpad and mouse-wheel scrolling pan the canvas naturally;
  trackpad pinch now performs smooth pointer-anchored zoom.
- Increased pinch responsiveness for the small, high-frequency deltas emitted
  by real trackpads.
- Expanded proof recording into an asserted end-to-end UX journey with a
  visible verification cursor, close/reopen persistence, structured checks,
  and a denser internal keyframe review sheet.
- Enlarged the selected-card resize handle hit target for more reliable pointer
  and trackpad interaction.
- Hardened card drag and canvas pan so browser text selection and native drag
  behavior do not take over the gesture.
- Made zoom verification cover both pinch zoom and toolbar zoom controls.
- Improved theme toggle affordance with explicit Light/Dark labeling.
- Centered the primary toolbar action content optically.
- Reflowed the mobile toolbar into the topbar so controls do not cover the
  product title or canvas.
- Kept static ECharts artifacts from refreshing or entering hover states during
  canvas drag, pan, and zoom.
- Bound the dotted grid background to the same viewport pan and zoom model as
  canvas nodes.
- Corrected pointer-anchored zoom and bundle placement to use stage-local
  coordinates when the top bar or Views sidebar offsets the canvas.
- Split view bootstrap from active-canvas composition and extracted artifact
  runtime, autosave, and node-factory responsibilities from `App.tsx`.
- Moved local-save status into a fixed-width slot before Theme/More so changing
  status text no longer shifts either toolbar controls or the Build command.
- Prevented superseded autosave callbacks from overwriting newer import errors or
  installation status.
- Split the canvas runtime into focused components, an interaction hook, debug
  state helper, domain CSS files, and shared verification script helpers.
- Slimmed `AGENTS.md` into an agent source map and moved product framing into
  README/docs.
- Refactored board, transform, and node creation boundaries out of the main app
  component.
- Split demo artifact seeds away from the artifact registry.

### Removed

- Removed the read-only selection inspector from the canvas UI; browser debug
  state remains available to verification tooling.
- Removed the redundant select tool and placeholder Add artifact behavior.
