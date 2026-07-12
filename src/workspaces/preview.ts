import type { CanvasNode } from "../artifacts/types";
import type { WorkspacePreviewNode } from "./types";

export function createWorkspacePreview(nodes: CanvasNode[]): WorkspacePreviewNode[] {
  return nodes.map(({ id, artifactId, x, y, width, height, zIndex }) => ({
    id,
    artifactId,
    x,
    y,
    width,
    height,
    zIndex,
  }));
}
