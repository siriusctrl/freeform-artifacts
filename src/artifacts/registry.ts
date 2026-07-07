import { latestRevenueSummary, revenueRows } from "../data/sampleDatabase";
import { flowDiagramArtifact } from "./FlowDiagram";
import { metricCardArtifact } from "./MetricCard";
import { tablePreviewArtifact } from "./TablePreview";
import type { ArtifactDefinition, CanvasNode } from "./types";

export type RegisteredArtifact = ArtifactDefinition<any, any>;

export const artifactRegistry: Record<string, RegisteredArtifact> = {
  [metricCardArtifact.id]: metricCardArtifact,
  [tablePreviewArtifact.id]: tablePreviewArtifact,
  [flowDiagramArtifact.id]: flowDiagramArtifact,
};

export const initialNodes: CanvasNode[] = [
  {
    id: "node-revenue",
    artifactId: "metric-card",
    title: "Revenue Summary",
    x: 90,
    y: 120,
    width: 280,
    height: 170,
    zIndex: 2,
    data: latestRevenueSummary(),
    config: {},
  },
  {
    id: "node-flow",
    artifactId: "flow-diagram",
    title: "Artifact Pipeline",
    x: 470,
    y: 78,
    width: 560,
    height: 300,
    zIndex: 1,
    data: {
      title: "Database rows to generated artifact",
      summary: "AI output stays inside the registry contract.",
      steps: [
        {
          label: "Query",
          detail: "6 revenue rows",
          metric: "raw",
        },
        {
          label: "Transform",
          detail: "normalize fields",
          metric: "typed",
        },
        {
          label: "Render",
          detail: "React artifact",
          metric: "live",
        },
      ],
    },
    config: {},
  },
  {
    id: "node-table",
    artifactId: "table-preview",
    title: "Database Rows",
    x: 120,
    y: 420,
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
