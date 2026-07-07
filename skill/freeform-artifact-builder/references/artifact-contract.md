# Artifact Contract

Use this reference when creating or editing artifact modules.

## File Placement

- Put artifact modules in `src/artifacts/<PascalName>.tsx`.
- Export one named artifact constant, for example `revenueBridgeArtifact`.
- Import and register it in `src/artifacts/registry.ts`.
- Keep reusable data transforms outside render/build functions.
- Put reusable Zod data schemas in `src/artifacts/schemas.ts`.

## Renderer Choice

Prefer ECharts for line, bar, scatter, heatmap, treemap, graph, Sankey, and
other standard chart families. Use React for bespoke cards, tables, compact
flows, mixed UI, controls, or non-chart composition.

## React Artifact Shape

```ts
import type { ArtifactDefinition } from "./types";
import { exampleDataSchema, type ExampleData } from "./schemas";

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
import type { EChartsArtifactDefinition } from "./types";
import { exampleChartDataSchema, type ChartData } from "./schemas";

export const exampleChartArtifact: EChartsArtifactDefinition<ChartData> = {
  id: "example-chart",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Example Chart",
  version: "0.1.0",
  defaultSize: { width: 640, height: 360 },
  dataSchema: {
    type: "object",
    required: ["title", "points"],
  },
  dataValidator: exampleChartDataSchema,
  buildOption: ({ data, theme }) => {
    const isDark = theme.mode === "dark";
    const text = isDark ? "#eef3f3" : "#171717";

    return {
      backgroundColor: "transparent",
      animationDuration: 500,
      title: {
        text: data.title,
        left: 24,
        top: 20,
        textStyle: { color: text, fontFamily: "Geist Variable" },
      },
      grid: { left: 48, right: 24, top: 76, bottom: 42 },
      xAxis: {
        type: "category",
        data: data.points.map((point) => point.label),
      },
      yAxis: { type: "value" },
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

## Data Rules

- Use serializable `data` and `config`.
- Keep `dataSchema` and `configSchema` as useful hints.
- Add Zod `dataValidator` and `configValidator` when introducing new artifact
  payload shapes.
- Use stable IDs with lowercase words and hyphens.
- Use `CanvasTheme` values for theme-sensitive colors.
- Avoid inline layout that can overflow the card at the declared `defaultSize`.
