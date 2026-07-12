import type { ReactNode } from "react";
import type { EChartsOption } from "echarts";
import type { ZodType } from "zod";

export type JsonObject = Record<string, unknown>;

export interface CanvasTheme {
  mode: "light" | "dark";
  accent: string;
  surface: string;
  text: string;
}

export interface ArtifactSize {
  width: number;
  height: number;
}

export type ChartKitValueFormat = "number" | "percent" | "currency";

export interface ChartKitCartesianSeries {
  id: string;
  name: string;
  type: "bar" | "line";
  values: number[];
  color?: string;
  stack?: string;
  smooth?: boolean;
  area?: boolean;
}

export interface ChartKitReferenceLine {
  value: number;
  label: string;
}

export interface ChartKitCartesianSpec {
  kind: "cartesian";
  title?: string;
  subtitle?: string;
  categories: string[];
  series: ChartKitCartesianSeries[];
  legend?: boolean;
  valueFormat?: ChartKitValueFormat;
  currency?: string;
  referenceLines?: ChartKitReferenceLine[];
}

export type ChartKitSpec = ChartKitCartesianSpec;

export interface ArtifactRenderProps<TData = unknown, TConfig = JsonObject> {
  data: TData;
  config: TConfig;
  size: ArtifactSize;
  theme: CanvasTheme;
}

interface ArtifactBase<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  defaultSize: ArtifactSize;
  minSize?: ArtifactSize;
  dataSchema?: JsonObject;
  configSchema?: JsonObject;
  dataValidator?: ZodType<TData>;
  configValidator?: ZodType<TConfig>;
}

export interface ReactArtifactDefinition<TData = unknown, TConfig = JsonObject> extends ArtifactBase<TData, TConfig> {
  renderer?: "react";
  render: (props: ArtifactRenderProps<TData, TConfig>) => ReactNode;
}

export interface EChartsArtifactDefinition<TData = unknown, TConfig = JsonObject>
  extends ArtifactBase<TData, TConfig> {
  renderer: "echarts";
  chartRenderer?: "svg" | "canvas";
  interactive?: boolean;
  buildOption: (props: ArtifactRenderProps<TData, TConfig>) => EChartsOption;
}

export interface ChartKitArtifactDefinition<TData = unknown, TConfig = JsonObject>
  extends ArtifactBase<TData, TConfig> {
  renderer: "chart-kit";
  buildChart: (props: ArtifactRenderProps<TData, TConfig>) => ChartKitSpec;
}

export type ArtifactDefinition<TData = unknown, TConfig = JsonObject> =
  | ReactArtifactDefinition<TData, TConfig>
  | EChartsArtifactDefinition<TData, TConfig>
  | ChartKitArtifactDefinition<TData, TConfig>;

export interface DataBinding {
  sourceId: string;
  transformId?: string;
  params?: JsonObject;
}

export interface CanvasNode<TConfig = JsonObject> {
  id: string;
  artifactId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  dataBinding?: DataBinding;
  data: unknown;
  config: TConfig;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}
