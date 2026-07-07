import type { ArtifactDefinition } from "./types";

interface TrendPoint {
  label: string;
  value: number;
}

interface TrendData {
  title: string;
  points: TrendPoint[];
}

export const trendCardArtifact: ArtifactDefinition<TrendData> = {
  id: "trend-card",
  title: "Trend Card",
  version: "0.1.0",
  defaultSize: { width: 340, height: 210 },
  dataSchema: {
    type: "object",
    required: ["title", "points"],
  },
  render: ({ data }) => {
    const values = data.points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);
    const points = data.points
      .map((point, index) => {
        const x = 24 + (index / Math.max(data.points.length - 1, 1)) * 276;
        const y = 128 - ((point.value - min) / range) * 86;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <article className="artifact trend-card">
        <div className="table-title">{data.title}</div>
        <svg viewBox="0 0 324 150" role="img" aria-label={data.title}>
          <path d="M24 132H300" className="trend-axis" />
          <polyline points={points} className="trend-line" />
          {data.points.map((point, index) => {
            const x = 24 + (index / Math.max(data.points.length - 1, 1)) * 276;
            const y = 128 - ((point.value - min) / range) * 86;
            return <circle key={point.label} cx={x} cy={y} r="4" className="trend-dot" />;
          })}
        </svg>
        <div className="trend-labels">
          <span>{data.points[0]?.label}</span>
          <span>{data.points.at(-1)?.label}</span>
        </div>
      </article>
    );
  },
};
