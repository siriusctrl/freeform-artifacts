export const artifact = {
  id: "runtime-margin-chart",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Runtime Margin Chart",
  version: "0.1.0",
  defaultSize: { width: 520, height: 320 },
  dataSchema: {
    type: "object",
    required: ["title", "points"],
  },
  buildOption: ({ data, theme }) => {
    const isDark = theme.mode === "dark";
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const points = Array.isArray(data?.points)
      ? data.points
      : [
          { label: "Q1", value: 31 },
          { label: "Q2", value: 35 },
          { label: "Q3", value: 38 },
          { label: "Q4", value: 41 },
        ];

    return {
      backgroundColor: "transparent",
      animationDuration: 400,
      title: {
        text: data?.title ?? "Runtime margin chart",
        left: 22,
        top: 18,
        textStyle: {
          color: text,
          fontFamily: "Instrument Sans Variable",
          fontSize: 21,
          fontWeight: 700,
        },
      },
      grid: { left: 46, right: 26, top: 74, bottom: 42 },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        axisLabel: { color: muted, fontFamily: "Geist Mono Variable" },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: muted, formatter: "{value}%", fontFamily: "Geist Mono Variable" },
        splitLine: { lineStyle: { color: isDark ? "rgba(238,243,243,0.16)" : "rgba(23,23,23,0.12)" } },
      },
      series: [
        {
          type: "line",
          smooth: 0.35,
          symbolSize: 7,
          data: points.map((point) => point.value),
          lineStyle: { color: theme.accent, width: 3 },
          itemStyle: { color: theme.accent },
          areaStyle: { color: isDark ? "rgba(53,200,220,0.12)" : "rgba(0,152,184,0.12)" },
        },
      ],
    };
  },
};
