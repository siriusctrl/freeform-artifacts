import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;

export interface CanvasTheme {
  mode: "light" | "dark";
  accent: string;
  surface: string;
  text: string;
}

export interface ArtifactEvent {
  type: string;
  payload?: JsonObject;
}

export interface ArtifactRenderProps<TData = unknown, TConfig = JsonObject> {
  data: TData;
  config: TConfig;
  theme: CanvasTheme;
  emit: (event: ArtifactEvent) => void;
}

export interface ArtifactDefinition<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  defaultSize: {
    width: number;
    height: number;
  };
  dataSchema?: JsonObject;
  configSchema?: JsonObject;
  render: (props: ArtifactRenderProps<TData, TConfig>) => ReactNode;
}

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
