# Artifact Contract

Use this reference when creating or editing artifact modules.

## File Placement

- Put platform-provided artifacts in `src/artifacts/core/`.
- Put demo or verification-only artifacts in `src/artifacts/examples/`.
- Put repo-compiled user/AI-generated artifacts under
  `src/artifacts/generated/` with the filename pattern `*.artifact.tsx`.
- Put runtime external ESM artifacts under `public/artifacts/generated/` and
  list them in `public/artifacts/generated/manifest.json`.
- Export one named artifact constant, for example `revenueBridgeArtifact`.
- Import and register it in the matching layer registry.
- Let `src/artifacts/registry.ts` only merge registry layers.
- Add default board placement in `src/canvas/seeds/demoBoard.ts`, not in the
  artifact registry.
- Keep reusable data transforms outside render/build functions.
- Put reusable Zod data schemas in `src/artifacts/schemas.ts`.

## Renderer Choice

Prefer ECharts for line, bar, scatter, heatmap, treemap, graph, Sankey, and
other standard chart families. Use React for bespoke cards, tables, compact
flows, mixed UI, controls, or non-chart composition.

## Generated Loading Paths

Repo-compiled generated artifacts can export `artifact`, `default`, or
`artifacts`:

```ts
export const artifact = exampleArtifact;
```

Runtime external artifacts use compiled browser ESM:

```js
export const artifact = {
  id: "runtime-margin-chart",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Runtime Margin Chart",
  version: "0.1.0",
  defaultSize: { width: 520, height: 320 },
  minSize: { width: 456, height: 304 },
  buildOption: ({ data, size, theme }) => ({
    backgroundColor: "transparent",
    grid: { left: 48, right: Math.max(24, size.width * 0.06) },
    series: [],
  }),
};
```

Manifest:

```json
{
  "artifacts": [
    { "module": "./runtime-margin-chart.js" }
  ]
}
```

External ESM modules are trusted self-hosted code. They are not sandboxed. Keep
them self-contained browser JavaScript; do not rely on relative imports from a
Blob-backed runtime module.
Runtime React artifacts can use `window.React.createElement`; runtime `.js`
files cannot contain raw JSX unless they are compiled first.

## React Artifact Shape

```ts
import type { ArtifactDefinition } from "../types";
import { exampleDataSchema, type ExampleData } from "../schemas";

export const exampleArtifact: ArtifactDefinition<ExampleData> = {
  id: "example-artifact",
  title: "Example Artifact",
  version: "0.1.0",
  defaultSize: { width: 320, height: 200 },
  dataSchema: {
    type: "object",
    required: ["title", "value"],
  },
  dataValidator: exampleDataSchema,
  render: ({ data, theme }) => (
    <article className="artifact">
      <h2>{data.title}</h2>
      <strong style={{ color: theme.text }}>{data.value}</strong>
    </article>
  ),
};
```

## ECharts Artifact Shape

```ts
import type { EChartsArtifactDefinition } from "../types";
import { exampleChartDataSchema, type ChartData } from "../schemas";

export const exampleChartArtifact: EChartsArtifactDefinition<ChartData> = {
  id: "example-chart",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Example Chart",
  version: "0.1.0",
  defaultSize: { width: 640, height: 360 },
  minSize: { width: 532, height: 304 },
  dataSchema: {
    type: "object",
    required: ["title", "points"],
  },
  dataValidator: exampleChartDataSchema,
  buildOption: ({ data, size, theme }) => {
    const isDark = theme.mode === "dark";
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const gridLine = isDark ? "rgba(238,243,243,0.18)" : "rgba(23,23,23,0.14)";

    return {
      backgroundColor: "transparent",
      animationDuration: 500,
      title: {
        text: data.title,
        left: 24,
        top: 20,
        textStyle: { color: text, fontFamily: "Instrument Sans Variable" },
      },
      grid: { left: 48, right: Math.max(24, size.width * 0.06), top: 76, bottom: 42 },
      xAxis: {
        type: "category",
        data: data.points.map((point) => point.label),
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: gridLine } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: gridLine } },
      },
      tooltip: {
        backgroundColor: isDark ? "#202628" : "#ffffff",
        borderColor: gridLine,
        textStyle: { color: text },
      },
      series: [
        {
          type: "bar",
          data: data.points.map((point) => point.value),
        },
      ],
    };
  },
};
```

## ECharts Host Modules

If a chart type or component is not registered, update
`src/artifacts/EChartsArtifactHost.tsx`:

- Import the chart from `echarts/charts`.
- Import needed components from `echarts/components`.
- Add them to the single `echarts.use([...])` call.

Keep the host generic. Do not add artifact-specific lifecycle code there.

Read [visual-style-guide.md](visual-style-guide.md) before finalizing copy,
spacing, color, or chart options. Dark mode is part of the artifact contract,
not an optional polish pass.

## Data Rules

- Use serializable `data` and `config`.
- Keep `dataSchema` and `configSchema` as useful hints.
- Add Zod `dataValidator` and `configValidator` when introducing new artifact
  payload shapes.
- Use stable IDs with lowercase words and hyphens.
- Use `CanvasTheme` values for theme-sensitive colors.
- Treat `defaultSize` as the fixed internal coordinate system used by canvas
  object scaling. Use `size` to lay out labels, annotations, legends, and plot
  margins inside that coordinate system.
- Declare `minSize` for dense visuals; the canvas converts it into the smallest
  permitted proportional object scale.
- Keep essential content inside the host at `defaultSize`; browser verification
  must also inspect the uniformly scaled minimum object.
