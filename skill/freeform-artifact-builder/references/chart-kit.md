# Chart Kit Contract

Chart Kit is the default chart API. It is a declarative layer over the host's
managed ECharts runtime; artifacts describe data and analytical intent while the
host owns theme, axes, grid, tooltip, palette, ARIA, renderer, and lifecycle.

## Supported Capabilities

Version 1 supports:

- `kind: "cartesian"`;
- bar series;
- line series;
- bar/line combo charts;
- optional stacking, smooth lines, area fill, legends, value formatting, and
  horizontal reference lines.

Read live browser capabilities from:

```js
window.__FREEFORM_AGENT__.capabilities.chartKit
```

Do not assume support for every ECharts chart family. The current raw ECharts
escape hatch registers bar, line, and Sankey only.

## Browser Bundle Example

Bundle `moduleSource` is self-contained JavaScript:

```js
export const artifact = {
  id: "regional-capacity",
  renderer: "chart-kit",
  title: "Regional Capacity",
  version: "1.0.0",
  defaultSize: { width: 560, height: 340 },
  minSize: { width: 456, height: 300 },
  buildChart: ({ data }) => ({
    kind: "cartesian",
    title: data.title,
    subtitle: data.subtitle,
    categories: data.points.map((point) => point.label),
    valueFormat: "number",
    series: [
      {
        id: "capacity",
        name: "Capacity",
        type: "bar",
        values: data.points.map((point) => point.value),
      },
    ],
  }),
};
```

## Cartesian Spec

```ts
interface ChartKitCartesianSpec {
  kind: "cartesian";
  title?: string;
  subtitle?: string;
  categories: string[];
  series: Array<{
    id: string;
    name: string;
    type: "bar" | "line";
    values: number[];
    color?: string;
    stack?: string;
    smooth?: boolean;
    area?: boolean;
  }>;
  legend?: boolean;
  valueFormat?: "number" | "percent" | "currency";
  currency?: string;
  referenceLines?: Array<{ value: number; label: string }>;
}
```

Series ids must be unique. Every values array must match the category count and
contain finite numbers. Prefer the managed palette; set `color` only when a
domain color carries stable meaning.

## Escape Hatches

Use raw `renderer: "echarts"` only when the requested chart needs registered
Sankey behavior, advanced `graphic`, or another option not represented by Chart
Kit. Use React when the artifact is primarily UI or composition rather than a
chart. A new ECharts chart type in a self-deployed repo requires explicit host
registration and verification; a browser bundle cannot add it.
