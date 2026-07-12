export const artifact = {
  id: "runtime-margin-chart",
  renderer: "chart-kit",
  title: "Runtime Margin Chart",
  version: "0.1.0",
  defaultSize: { width: 520, height: 320 },
  dataSchema: {
    type: "object",
    required: ["title", "points"],
  },
  buildChart: ({ data }) => {
    const points = Array.isArray(data?.points)
      ? data.points
      : [
          { label: "Q1", value: 31 },
          { label: "Q2", value: 35 },
          { label: "Q3", value: 38 },
          { label: "Q4", value: 41 },
        ];

    return {
      kind: "cartesian",
      title: data?.title ?? "Runtime margin chart",
      categories: points.map((point) => point.label),
      valueFormat: "percent",
      series: [
        {
          id: "margin",
          name: "Margin",
          type: "line",
          smooth: true,
          area: true,
          values: points.map((point) => Number(point.value) > 1 ? Number(point.value) / 100 : Number(point.value)),
        },
      ],
    };
  },
};
