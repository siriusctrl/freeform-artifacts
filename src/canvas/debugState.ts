import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import type { ThemeMode } from "./constants";
import { CANVAS_GRID_SIZE } from "../lib/geometry";

interface CanvasDebugStateOptions {
  artifactRegistry: Record<string, RegisteredArtifact>;
  nodes: CanvasNode[];
  selectedNodeId: string;
  snapToGrid: boolean;
  status: string;
  storageMode: "indexeddb" | "localstorage";
  templateId: string;
  themeMode: ThemeMode;
  viewport: CanvasViewport;
}

export function publishCanvasDebugState({
  artifactRegistry,
  nodes,
  selectedNodeId,
  snapToGrid,
  status,
  storageMode,
  templateId,
  themeMode,
  viewport,
}: CanvasDebugStateOptions) {
  window.__FREEFORM_STATE__ = {
    artifactIds: Object.keys(artifactRegistry),
    nodes,
    selectedNodeId,
    snapGridSize: CANVAS_GRID_SIZE,
    snapToGrid,
    status,
    storageMode,
    templateId,
    themeMode,
    viewport,
  };
}

declare global {
  interface Window {
    __FREEFORM_STATE__?: {
      readonly nodes: CanvasNode[];
      readonly viewport: CanvasViewport;
      readonly selectedNodeId: string;
      readonly themeMode: ThemeMode;
      readonly snapToGrid: boolean;
      readonly snapGridSize: number;
      readonly status: string;
      readonly storageMode: "indexeddb" | "localstorage";
      readonly templateId: string;
      readonly artifactIds: string[];
    };
  }
}
