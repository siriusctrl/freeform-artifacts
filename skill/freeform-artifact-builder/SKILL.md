---
name: freeform-artifact-builder
description: Create, edit, register, and lay out compliant Freeform Artifacts canvas cards in this React/TypeScript project. Use when Codex needs to build AI-generated data artifacts, ECharts chart artifacts, custom React artifacts, registry entries, initial canvas nodes, or browser-proofed artifact layouts for the freeform-artifacts app.
---

# Freeform Artifact Builder

Use this skill to add or revise artifact cards for the `freeform-artifacts`
canvas.

## Workflow

1. Read `src/artifacts/types.ts`, `src/artifacts/registry.ts`, and the closest
   existing artifact module.
2. Read [references/artifact-contract.md](references/artifact-contract.md)
   before writing or changing an artifact.
3. Read [references/layout-verification.md](references/layout-verification.md)
   before changing initial node placement or visual proof behavior.
4. Choose the renderer:
   - Use `renderer: "echarts"` for standard charts.
   - Use React artifacts for custom UI, composition, or visuals ECharts does not
     express cleanly.
5. Keep database shaping outside artifact render/build functions. Pass normalized
   data through `CanvasNode.data`.
6. For repo-compiled generated artifacts, create
   `src/artifacts/generated/<name>.artifact.tsx`; the generated registry
   auto-discovers that filename pattern.
7. For runtime external artifacts, create a compiled ESM file under
   `public/artifacts/generated/` and list it in
   `public/artifacts/generated/manifest.json`.
8. Register core/example artifacts in the right registry layer and add or update
   `src/canvas/seeds/demoBoard.ts` only when the demo should show it by default.
   Increment the published template version in `src/workspaces/templates.ts`
   whenever the authored demo board changes.
9. Run `npm run check`, `npm run verify:ui`, `npm run verify:preview`, and
   `npm run verify:proof` for user-facing visual or interaction changes.
10. Inspect the generated GIF, internal `contact-sheet.png`, and
   `frame-check.json`; report only the GIF proof path to the user unless they
   ask for more.

## Hard Rules

- Do not let generated artifacts mutate canvas state directly.
- Do not call `echarts.init`, `setOption`, `resize`, or `dispose` inside an
  artifact; the host owns lifecycle.
- Keep ECharts artifacts non-interactive by default so card dragging remains
  primary.
- Add `interactive: true` only when chart-level hover, tooltip, click, or brush
  behavior is required.
- Keep text readable in both light and dark mode.
- Keep default demo node positions and sizes grid-friendly; the canvas host
  owns 38px snap-to-grid placement.
- Declare `minSize` for dense or complex artifacts and use the live `size`
  render prop to reflow content at default and minimum dimensions.
- Scale a dense artifact's typography, marks, and spacing relative to its
  `defaultSize` when card resize should feel proportional; clamp that visual
  scale so responsive reflow and readability remain intact.
- Keep every essential chart label and annotation inside the artifact host;
  verify SVG text bounds instead of assuming `chart.resize()` prevents clipping.
- Treat line wrapping and annotation layout as artifact responsibilities. A
  newline in rich text is not proof of separate SVG lines; inspect rendered
  element positions at default and minimum sizes.
- Attach a Zod `dataValidator` to new artifacts.
- Treat runtime external ESM artifacts as trusted self-hosted code, not
  sandboxed plugins.
- Do not rely on random values, timers, network fetches, or mutable globals
  during render.
- Keep generated code trusted and compiled until a sandbox is implemented.
