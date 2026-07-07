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
6. Register the artifact in `src/artifacts/registry.ts` and add or update
   `initialNodes` only when the demo should show it by default.
7. Run `npm run check`, `npm run verify:ui`, `npm run verify:preview`, and
   `npm run verify:proof` for user-facing visual or interaction changes.
8. Inspect the generated GIF, internal `contact-sheet.png`, and
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
- Attach a Zod `dataValidator` to new artifacts.
- Do not rely on random values, timers, network fetches, or mutable globals
  during render.
- Keep generated code trusted and compiled until a sandbox is implemented.
