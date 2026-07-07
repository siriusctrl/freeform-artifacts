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
- Playwright browser smoke test for core canvas interactions.
- Browser proof recorder that writes WebM, GIF, screenshot, manifest, and
  inspection artifacts.
- Internal proof contact sheet generation for keyframe inspection.
- README, AGENTS, architecture, testing, and visual-verification handoff docs.
- Project-local `freeform-artifact-builder` skill for future agents creating
  compliant artifacts and canvas layouts.

### Fixed

- Hardened card drag and canvas pan so browser text selection and native drag
  behavior do not take over the gesture.
- Made zoom verification cover both wheel zoom and toolbar zoom controls.
- Improved theme toggle affordance with explicit Light/Dark labeling.
- Centered the add-artifact action content optically.
- Kept static ECharts artifacts from refreshing or entering hover states during
  canvas drag, pan, and zoom.

### Removed

- Removed the low-value sidebar so the first screen prioritizes the canvas.
