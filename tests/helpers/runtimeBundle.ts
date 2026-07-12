export function agentArtifactBundle(artifactId = "agent-forecast-card") {
  return {
    version: 1 as const,
    artifactId,
    moduleSource: `export const artifact = {
      id: ${JSON.stringify(artifactId)},
      renderer: "chart-kit",
      title: "Agent Forecast",
      version: "1.0.0",
      defaultSize: { width: 480, height: 300 },
      buildChart: ({ data }) => ({
        kind: "cartesian",
        title: data.title,
        categories: data.points.map((point) => point.label),
        series: [
          { id: "forecast", name: "Forecast", type: "bar", values: data.points.map((point) => point.value) },
          { id: "trend", name: "Trend", type: "line", values: data.points.map((point) => point.value * 0.92), smooth: true },
        ],
      }),
    };`,
    node: {
      title: "Agent forecast",
      data: { title: "Installed without a deploy", points: [{ label: "Q1", value: 24 }, { label: "Q2", value: 37 }] },
      config: {},
    },
  };
}
