import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import type { ThemeMode } from "./constants";
import { CANVAS_GRID_SIZE } from "../lib/geometry";

interface CanvasDebugStateOptions {
  artifactLibraryOpen: boolean;
  artifactLibraryCounts: { builtIn: number; personal: number };
  artifactRegistry: Record<string, RegisteredArtifact>;
  nodes: CanvasNode[];
  canRedo: boolean;
  canUndo: boolean;
  presentationMode: boolean;
  selectedNodeId: string;
  selectedNodeIds: string[];
  snapToGrid: boolean;
  status: string;
  storageMode: "indexeddb" | "localstorage";
  templateId: string;
  themeMode: ThemeMode;
  viewport: CanvasViewport;
}

export function publishCanvasDebugState({
  artifactLibraryOpen,
  artifactLibraryCounts,
  artifactRegistry,
  nodes,
  canRedo,
  canUndo,
  presentationMode,
  selectedNodeId,
  selectedNodeIds,
  snapToGrid,
  status,
  storageMode,
  templateId,
  themeMode,
  viewport,
}: CanvasDebugStateOptions) {
  window.__FREEFORM_STATE__ = {
    artifactLibraryOpen,
    artifactLibraryCounts,
    artifactIds: Object.keys(artifactRegistry),
    canRedo,
    canUndo,
    nodes,
    presentationMode,
    selectedNodeId,
    selectedNodeIds,
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
      readonly artifactLibraryOpen: boolean;
      readonly artifactLibraryCounts: { builtIn: number; personal: number };
      readonly viewport: CanvasViewport;
      readonly selectedNodeId: string;
      readonly selectedNodeIds: string[];
      readonly canRedo: boolean;
      readonly canUndo: boolean;
      readonly presentationMode: boolean;
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
