# Changelog

All notable user-facing changes to this project should be documented here.

## 0.1.0 - Unreleased

### Added

- Initial React/TypeScript/Vite freeform artifact canvas.
- DOM-based artifact nodes with pan, zoom, drag, selection, and add-artifact
  interaction.
- Light/dark mode support.
- Artifact contract and registry with metric, table, and flow-diagram examples.
- Managed ECharts artifact host for standard chart artifacts.
- Probability chart and Sankey examples backed by ECharts options.
- Self-hosted Geist Sans and Geist Mono typography.
- Sample database rows and transform helpers.
- Persistent board autosave/restore and board JSON export.
- Default-on 38px snap-to-grid placement and resizing with a toolbar toggle.
- Selected-card resize handles.
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
  `/artifacts/generated/manifest.json`.

### Fixed

- Hardened card drag and canvas pan so browser text selection and native drag
  behavior do not take over the gesture.
- Made zoom verification cover both wheel zoom and toolbar zoom controls.
- Improved theme toggle affordance with explicit Light/Dark labeling.
- Centered the add-artifact action content optically.
- Kept static ECharts artifacts from refreshing or entering hover states during
  canvas drag, pan, and zoom.
- Bound the dotted grid background to the same viewport pan and zoom model as
  canvas nodes.
- Split the canvas runtime into focused components, an interaction hook, debug
  state helper, domain CSS files, and shared verification script helpers.
- Refactored board, transform, and node creation boundaries out of the main app
  component.
- Split demo artifact seeds away from the artifact registry.

### Removed

- Removed the low-value sidebar so the first screen prioritizes the canvas.
