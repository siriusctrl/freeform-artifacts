import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { ArtifactSize, CanvasNode } from "../artifacts/types";

export const DEFAULT_MIN_NODE_SIZE: ArtifactSize = { width: 180, height: 130 };

export function artifactMinSize(
  node: CanvasNode,
  artifactRegistry: Record<string, RegisteredArtifact>,
): ArtifactSize {
  return artifactRegistry[node.artifactId]?.minSize ?? DEFAULT_MIN_NODE_SIZE;
}

export function clampNodesToArtifactMinimums(
  nodes: CanvasNode[],
  artifactRegistry: Record<string, RegisteredArtifact>,
): CanvasNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const minSize = artifactMinSize(node, artifactRegistry);
    const width = Math.max(node.width, minSize.width);
    const height = Math.max(node.height, minSize.height);
    if (width === node.width && height === node.height) {
      return node;
    }
    changed = true;
    return { ...node, width, height };
  });

  return changed ? nextNodes : nodes;
}
