import type { ArtifactDefinition } from "./types";

interface MetricData {
  label: string;
  value: number;
  delta: number;
  caption: string;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export const metricCardArtifact: ArtifactDefinition<MetricData> = {
  id: "metric-card",
  title: "Metric Card",
  version: "0.1.0",
  defaultSize: { width: 280, height: 170 },
  dataSchema: {
    type: "object",
    required: ["label", "value", "delta", "caption"],
  },
  render: ({ data }) => (
    <article className="artifact metric-card">
      <div className="artifact-kicker">{data.label}</div>
      <div className="metric-value">{formatCurrency(data.value)}</div>
      <div className="metric-row">
        <span className="metric-delta">+{Math.round(data.delta * 100)}%</span>
        <span>{data.caption}</span>
      </div>
    </article>
  ),
};
