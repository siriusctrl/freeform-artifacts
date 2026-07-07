import { latestRevenueSummary, revenueRows } from "../data/sampleDatabase";
import { flowDiagramArtifact } from "./FlowDiagram";
import { inflectionProbabilityArtifact } from "./InflectionProbability";
import { metricCardArtifact } from "./MetricCard";
import { sankeyFlowArtifact } from "./SankeyFlow";
import { tablePreviewArtifact } from "./TablePreview";
import type { ArtifactDefinition, CanvasNode } from "./types";

export type RegisteredArtifact = ArtifactDefinition<any, any>;

export const artifactRegistry: Record<string, RegisteredArtifact> = {
  [metricCardArtifact.id]: metricCardArtifact,
  [tablePreviewArtifact.id]: tablePreviewArtifact,
  [flowDiagramArtifact.id]: flowDiagramArtifact,
  [inflectionProbabilityArtifact.id]: inflectionProbabilityArtifact,
  [sankeyFlowArtifact.id]: sankeyFlowArtifact,
};

export const initialNodes: CanvasNode[] = [
  {
    id: "node-revenue",
    artifactId: "metric-card",
    title: "Revenue Summary",
    x: 80,
    y: 90,
    width: 280,
    height: 170,
    zIndex: 2,
    data: latestRevenueSummary(),
    config: {},
  },
  {
    id: "node-probability",
    artifactId: "inflection-probability",
    title: "Supply-Demand Model",
    x: 410,
    y: 80,
    width: 720,
    height: 460,
    zIndex: 1,
    data: {
      title: "Supply-demand inflection probability",
      note: {
        what: "Probability that DRAM supply growth outpaces demand by quarter.",
        read: "Bars show P(inflection at T). The line shows cumulative P by T.",
        logic: "Requires supply above demand, DOI recovery, and supplier capacity online.",
      },
      points: [
        { quarter: "2026Q2", probabilityAt: 0, probabilityBy: 0 },
        { quarter: "2026Q3", probabilityAt: 0, probabilityBy: 0 },
        { quarter: "2026Q4", probabilityAt: 0, probabilityBy: 0 },
        { quarter: "2027Q1", probabilityAt: 0, probabilityBy: 0.002 },
        { quarter: "2027Q2", probabilityAt: 0.004, probabilityBy: 0.006 },
        { quarter: "2027Q3", probabilityAt: 0.014, probabilityBy: 0.016 },
        { quarter: "2027Q4", probabilityAt: 0.032, probabilityBy: 0.046 },
        { quarter: "2028Q1", probabilityAt: 0.052, probabilityBy: 0.094 },
        { quarter: "2028Q2", probabilityAt: 0.046, probabilityBy: 0.138 },
        { quarter: "2028Q3", probabilityAt: 0.073, probabilityBy: 0.202 },
        { quarter: "2028Q4", probabilityAt: 0.116, probabilityBy: 0.294 },
        { quarter: "2029Q1", probabilityAt: 0.136, probabilityBy: 0.386 },
        { quarter: "2029Q2", probabilityAt: 0.247, probabilityBy: 0.538 },
        { quarter: "2029Q3", probabilityAt: 0.252, probabilityBy: 0.654 },
      ],
      markers: {
        p25: "2028Q4",
        p50: "2029Q2",
        p75: "2030Q1",
      },
    },
    config: {},
  },
  {
    id: "node-flow",
    artifactId: "flow-diagram",
    title: "Artifact Pipeline",
    x: 190,
    y: 610,
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
    id: "node-sankey",
    artifactId: "sankey-flow",
    title: "Allocation Sankey",
    x: 840,
    y: 610,
    width: 600,
    height: 360,
    zIndex: 2,
    data: {
      title: "Supply allocation flow",
      subtitle: "Capacity moves from committed wafers into AI servers, mobile memory, and spot inventory.",
      nodes: [
        { name: "Wafer starts" },
        { name: "HBM stack" },
        { name: "DDR5" },
        { name: "LPDDR" },
        { name: "AI servers" },
        { name: "Client" },
      ],
      links: [
        { source: "Wafer starts", target: "HBM stack", value: 42 },
        { source: "Wafer starts", target: "DDR5", value: 34 },
        { source: "Wafer starts", target: "LPDDR", value: 24 },
        { source: "HBM stack", target: "AI servers", value: 38 },
        { source: "DDR5", target: "AI servers", value: 14 },
        { source: "DDR5", target: "Client", value: 20 },
        { source: "LPDDR", target: "Client", value: 24 },
      ],
    },
    config: {},
  },
  {
    id: "node-table",
    artifactId: "table-preview",
    title: "Database Rows",
    x: 80,
    y: 310,
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
