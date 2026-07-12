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
- Self-hosted Geist Sans and Geist Mono typography.
- Sample database rows and transform helpers.
- Published template forking into per-browser IndexedDB workspaces.
- Synchronous localStorage recovery mirrors for close/reopen resilience.
- Versioned workspace JSON import/export and explicit reset-to-demo control.
- Default-on 38px snap-to-grid placement and resizing with a toolbar setting.
- Selected-card resize handles.
- Selected-artifact deletion from the title bar and with `Delete`/`Backspace`.
- Repository-aware **Build with AI** handoff generation for Claude Code.
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

### Fixed

- Moved snap-to-grid into a labeled More-menu setting with immediate On/Off
  feedback, and aligned all top-level toolbar controls to one height.
- Split probability chart guidance into three independently positioned SVG
  lines so What, Read, and Logic remain inside the note panel.
- Replaced semiconductor-specific demo wording with a generic renewable supply
  and allocation scenario.
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
- Removed the low-value sidebar so the first screen prioritizes the canvas.
