# Changelog

All notable user-facing changes to this project should be documented here.

## 0.1.0 - Unreleased

### Added

- Initial React/TypeScript/Vite freeform artifact canvas.
- DOM-based artifact nodes with pan, zoom, drag, selection, and add-artifact
  interaction.
- Light/dark mode support.
- Sidebar collapse and reopen controls.
- Artifact contract and registry with metric, table, and trend examples.
- Sample database rows and transform helpers.
- Playwright browser smoke test for core canvas interactions.
- Browser proof recorder that writes WebM, GIF, screenshot, manifest, and
  inspection artifacts.
- README, AGENTS, architecture, testing, and visual-verification handoff docs.

### Fixed

- Hardened card drag and canvas pan so browser text selection and native drag
  behavior do not take over the gesture.
- Made zoom verification cover both wheel zoom and toolbar zoom controls.
