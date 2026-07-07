import { z } from "zod";

export const metricDataSchema = z.object({
  label: z.string(),
  value: z.number(),
  delta: z.number(),
  caption: z.string(),
});

export type MetricData = z.infer<typeof metricDataSchema>;

export const tablePreviewDataSchema = z.object({
  title: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
    }),
  ),
  rows: z.array(z.record(z.string(), z.string().or(z.number()))),
});

export type TablePreviewData = z.infer<typeof tablePreviewDataSchema>;

export const flowDiagramDataSchema = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(
    z.object({
      label: z.string(),
      detail: z.string(),
      metric: z.string(),
    }),
  ),
});

export type FlowDiagramData = z.infer<typeof flowDiagramDataSchema>;

export const inflectionProbabilityDataSchema = z.object({
  title: z.string(),
  note: z.object({
    what: z.string(),
    read: z.string(),
    logic: z.string(),
  }),
  points: z.array(
    z.object({
      quarter: z.string(),
      probabilityAt: z.number().min(0).max(1),
      probabilityBy: z.number().min(0).max(1),
    }),
  ),
  markers: z.object({
    p25: z.string(),
    p50: z.string(),
    p75: z.string(),
  }),
});

export type InflectionProbabilityData = z.infer<typeof inflectionProbabilityDataSchema>;

export const sankeyFlowDataSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  nodes: z.array(z.object({ name: z.string() })),
  links: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      value: z.number().positive(),
    }),
  ),
});

export type SankeyFlowData = z.infer<typeof sankeyFlowDataSchema>;
