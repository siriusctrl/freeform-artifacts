export function agentArtifactBundle(artifactId = "agent-forecast-card") {
  return {
    version: 1 as const,
    artifactId,
    moduleSource: `export const artifact = {
      id: ${JSON.stringify(artifactId)},
      renderer: "echarts",
      chartRenderer: "svg",
      title: "Agent Forecast",
      version: "1.0.0",
      defaultSize: { width: 480, height: 300 },
      buildOption: ({ data, theme }) => ({
        animation: false,
        backgroundColor: "transparent",
        title: { text: data.title, left: 24, top: 20, textStyle: { color: theme.text, fontSize: 22 } },
        xAxis: { type: "category", data: data.points.map((point) => point.label) },
        yAxis: { type: "value" },
        grid: { left: 48, right: 24, top: 76, bottom: 40 },
        series: [{ type: "bar", data: data.points.map((point) => point.value), itemStyle: { color: theme.accent } }],
      }),
    };`,
    node: {
      title: "Agent forecast",
      data: { title: "Installed without a deploy", points: [{ label: "Q1", value: 24 }, { label: "Q2", value: 37 }] },
      config: {},
    },
  };
}
