# Layout And Verification

Use this reference when placing artifacts on the default canvas or changing
proof behavior.

## Canvas Layout

Canvas nodes use world coordinates:

```ts
{
  id: "node-example",
  artifactId: "example-artifact",
  title: "Example",
  x: 80,
  y: 90,
  width: 320,
  height: 200,
  zIndex: 2,
  data: {},
  config: {},
}
```

Guidelines:

- Keep the first viewport useful at `INITIAL_VIEWPORT = { x: 80, y: 80, scale: 1 }`.
- Avoid hiding the primary example behind the toolbar or zoom controls.
- The canvas defaults to a 38px snap grid. Prefer grid-aligned positions and
  sizes for default demo nodes unless an intentional stagger improves scanning.
- Use 24-40 px gaps between cards when possible.
- Prefer `280x170` for metric cards, `430x260` for table previews,
  `560x300` for flow cards, and `600-760` wide cards for complex charts.
- Put the most important artifact in the upper-middle area.
- Let lower or right-side artifacts be partially visible only when that helps
  communicate that the board extends.
- Increase `zIndex` only when overlap is intentional.

## Verification

For user-facing visual or interaction changes, run:

```sh
npm run check
npm run verify:ui
npm run verify:preview
npm run verify:proof
```

`verify:proof` writes:

- `proof.gif` for user-facing review.
- `contact-sheet.png` for internal keyframe review.
- `frame-check.json` for sampled blank-frame statistics.
- `final-screenshot.png` for supplementary static inspection.
- `manifest.json` and `inspection.txt` for handoff details.

Inspect the GIF and `contact-sheet.png` before reporting completion. Look for:

- chart labels that jump for one frame;
- hover highlights or tooltips that should not appear in static cards;
- blank startup frames;
- card drag moving the wrong layer;
- browser text selection during drag;
- zoom controls covering essential content;
- chart annotations or external labels crossing the artifact host boundary;
- unreadable text in light or dark mode.

Capture and inspect the changed artifact in both light and dark mode. For
ECharts, verify that theme switching changes theme-sensitive SVG fills/strokes
and that categorical charts retain the intended number of distinct colors.
Visible text existing in the DOM is insufficient: it must be readable,
unclipped, and visually separated from neighboring content.

Also inspect `frame-check.json`; `blankFrameCount` should be 0. In final user
replies, include the GIF path and summarize verification. Do not surface
`contact-sheet.png` unless asked.
