import type { ArtifactDefinition } from "../types";
import { metricDataSchema, type MetricData } from "../schemas";

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
  dataValidator: metricDataSchema,
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
