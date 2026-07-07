import { latestRevenueSummary, revenueRows, revenueTrend } from "../data/sampleDatabase";
import { metricCardArtifact } from "./MetricCard";
import { tablePreviewArtifact } from "./TablePreview";
import { trendCardArtifact } from "./TrendCard";
import type { ArtifactDefinition, CanvasNode } from "./types";

export type RegisteredArtifact = ArtifactDefinition<any, any>;

export const artifactRegistry: Record<string, RegisteredArtifact> = {
  [metricCardArtifact.id]: metricCardArtifact,
  [tablePreviewArtifact.id]: tablePreviewArtifact,
  [trendCardArtifact.id]: trendCardArtifact,
};

export const initialNodes: CanvasNode[] = [
  {
    id: "node-revenue",
    artifactId: "metric-card",
    title: "Revenue Summary",
    x: 120,
    y: 90,
    width: 280,
    height: 170,
    zIndex: 2,
    data: latestRevenueSummary(),
    config: {},
  },
  {
    id: "node-trend",
    artifactId: "trend-card",
    title: "Revenue Trend",
    x: 470,
    y: 140,
    width: 340,
    height: 210,
    zIndex: 1,
    data: {
      title: "Revenue growth",
      points: revenueTrend(),
    },
    config: {},
  },
  {
    id: "node-table",
    artifactId: "table-preview",
    title: "Database Rows",
    x: 220,
    y: 390,
    width: 430,
    height: 260,
    zIndex: 3,
    data: {
      title: "revenue_rows",
      columns: [
        { key: "month", label: "Month" },
        { key: "revenue", label: "Revenue" },
        { key: "customers", label: "Customers" },
        { key: "churn", label: "Churn" },
      ],
      rows: revenueRows.slice(-4).map((row) => ({
        month: row.month,
        revenue: `$${Math.round(row.revenue / 1000)}k`,
        customers: row.customers,
        churn: `${Math.round(row.churn * 1000) / 10}%`,
      })),
    },
    config: {},
  },
];
