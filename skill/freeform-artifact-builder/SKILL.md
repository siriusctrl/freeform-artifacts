---
name: freeform-artifact-builder
description: Create, deliver, and verify compliant Freeform Artifacts canvas cards. Use for browser-local Build with AI bundles, self-deployed repo artifacts, Chart Kit charts, raw ECharts escape hatches, custom React artifacts, and canvas layout verification.
---

# Freeform Artifact Builder

Use this skill to add or revise artifact cards for the `freeform-artifacts`
canvas.

## Choose Delivery Mode First

Do not write code until the delivery mode is known.

### Browser View Bundle

Use this mode when the instruction contains `Delivery mode:
BROWSER_VIEW_BUNDLE`, comes from the in-product **Build with AI** dialog, names a
target view id, or asks to add an artifact without changing the deployed app.

- Final deliverable: one self-contained `.freeform-artifact.json` bundle, or the
  artifact installed into the named browser-local view.
- Write the bundle outside the application source tree.
- Do not create `src/artifacts/generated/*`, edit the repository, commit, or
  deploy.
- Follow [references/artifact-bundle.md](references/artifact-bundle.md).
- Call `window.__FREEFORM_AGENT__.validateArtifact(bundle)` before
  `installArtifact(bundle, { viewId })` when browser control is available.

### Self-Deployed Repo

Use this mode when the user owns or deploys the project and explicitly wants the
artifact to ship with that deployment.

- Final deliverable: `src/artifacts/generated/<name>.artifact.tsx`.
- Repo-compiled artifacts may import project types, Chart Kit types, helpers,
  and Zod schemas.
- The generated registry auto-discovers `*.artifact.tsx`.
- Add a node to `src/canvas/seeds/demoBoard.ts` only when the authored public demo
  should include it, and increment the template version when that seed changes.
- Run the complete repository verification chain before handoff.

If neither mode is clear, ask one delivery question before creating files. Never
silently convert a browser-view request into a repository change or a
self-deployed artifact into a personal bundle.

## Authoring Workflow

1. Read `src/artifacts/types.ts`, `src/artifacts/registry.ts`, and the closest
   artifact module.
2. Read [references/artifact-contract.md](references/artifact-contract.md),
   [references/chart-kit.md](references/chart-kit.md), and
   [references/visual-style-guide.md](references/visual-style-guide.md).
3. Choose the renderer in this order:
   - `renderer: "chart-kit"` for ordinary bar, line, and combo charts.
   - `renderer: "echarts"` only for registered ECharts capabilities the Chart
     Kit cannot express.
   - React for non-chart UI, tables, controls, and bespoke composition.
4. Keep database shaping outside artifact render/build functions. Pass normalized
   data through `CanvasNode.data`.
5. Produce the deliverable at the location required by the selected mode.
6. Apply the quality gate below before reporting completion.

## Quality Gate

For a Browser View Bundle:

1. Confirm `window.__FREEFORM_AGENT__.capabilities` supports the requested chart.
2. Run the non-persisting `validateArtifact(bundle)` preflight. It checks bundle
   shape, payload validation, renderer capability, and Chart Kit/ECharts option
   generation at default/minimum size in light/dark mode.
3. Install only after preflight succeeds.
4. Inspect the installed card at default and minimum size in both themes. Test
   longest labels, largest values, empty data, and nearby-card composition.
5. Return the bundle when the same browser profile cannot be controlled.

For a Self-Deployed Repo, run `npm run check`, `npm run verify:ui`, `npm run
verify:preview`, and `npm run verify:proof`. Inspect the GIF, internal contact
sheet, and frame check before handoff.

## Hard Rules

- Do not let generated artifacts mutate canvas state directly.
- Do not call `echarts.init`, `setOption`, `resize`, or `dispose` inside an
  artifact; the host owns lifecycle.
- Do not write raw ECharts options for a chart that Chart Kit supports.
- Do not request an ECharts series/component absent from the host capability
  list. Browser bundles cannot register new host modules.
- Keep ECharts artifacts non-interactive by default so card dragging remains
  primary.
- Add `interactive: true` only when chart-level hover, tooltip, click, or brush
  behavior is required.
- Implement light and dark mode deliberately. Theme ECharts titles, axes,
  legends, annotations, tooltips, marks, nodes, links, and emphasis states; do
  not rely on ECharts defaults to match the host.
- Do not expose internal table, query, transform, variable, or schema names as
  user-facing copy.
- Remove redundant titles, counters, badges, and nested panels before reducing
  text size to make content fit.
- Keep default demo node positions and sizes grid-friendly; the canvas host
  owns 38px snap-to-grid placement.
- Declare `minSize` for dense or complex artifacts and use the live `size`
  render prop for its internal default-size layout.
- Treat `defaultSize` as the artifact's fixed internal coordinate system. The
  canvas host owns aspect-locked object resize and scales the complete node; do
  not independently counter-scale typography, marks, or controls.
- Keep every essential chart label and annotation inside the artifact host;
  verify SVG text bounds instead of assuming `chart.resize()` prevents clipping.
- Treat line wrapping and annotation layout as artifact responsibilities. A
  newline in rich text is not proof of separate SVG lines; inspect rendered
  element positions at default and minimum sizes.
- Attach a Zod `dataValidator` to repo-compiled artifacts. Runtime bundles are
  self-contained and cannot import Zod; validate uncertain payload fields inside
  the renderer/build function and rely on the host's per-card error isolation.
- Treat `artifactId` as an immutable package identity. Use a new id when bundle
  implementation changes; the host rejects different code under an installed id.
- Treat runtime external ESM artifacts as trusted self-hosted code, not
  sandboxed plugins.
- Keep bundle `moduleSource` self-contained: no imports, fetches, credentials,
  timers, or external dependencies. Prefer Chart Kit specs; use raw ECharts or
  `window.React` only for the documented escape hatches.
- Do not rely on random values, timers, network fetches, or mutable globals
  during render.
- Keep generated code trusted and compiled until a sandbox is implemented.
