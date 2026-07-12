import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { ArtifactSize, CanvasNode } from "../artifacts/types";

export const DEFAULT_MIN_NODE_SIZE: ArtifactSize = { width: 180, height: 130 };

function roundSize(value: number) {
  return Math.round(value * 100) / 100;
}

function minimumArtifactScale(artifact: RegisteredArtifact) {
  const minSize = artifact.minSize ?? DEFAULT_MIN_NODE_SIZE;
  return Math.max(
    minSize.width / artifact.defaultSize.width,
    minSize.height / artifact.defaultSize.height,
  );
}

export function artifactObjectScale(node: CanvasNode, artifact?: RegisteredArtifact): number {
  return artifact ? node.width / artifact.defaultSize.width : 1;
}

export function resizeNodeToArtifactAspect(
  artifact: RegisteredArtifact | undefined,
  targetWidth: number,
  targetHeight: number,
): ArtifactSize {
  if (!artifact) {
    const minSize = DEFAULT_MIN_NODE_SIZE;
    return {
      width: Math.max(minSize.width, Math.round(targetWidth)),
      height: Math.max(minSize.height, Math.round(targetHeight)),
    };
  }

  const { width: baseWidth, height: baseHeight } = artifact.defaultSize;
  const projectedScale =
    (baseWidth * targetWidth + baseHeight * targetHeight) /
    (baseWidth * baseWidth + baseHeight * baseHeight);
  const scale = Math.max(minimumArtifactScale(artifact), projectedScale);
  return {
    width: roundSize(baseWidth * scale),
    height: roundSize(baseHeight * scale),
  };
}

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
    const artifact = artifactRegistry[node.artifactId];
    if (!artifact) {
      const minSize = artifactMinSize(node, artifactRegistry);
      const width = Math.max(node.width, minSize.width);
      const height = Math.max(node.height, minSize.height);
      if (width === node.width && height === node.height) return node;
      changed = true;
      return { ...node, width, height };
    }

    const scale = Math.max(
      minimumArtifactScale(artifact),
      node.width / artifact.defaultSize.width,
      node.height / artifact.defaultSize.height,
    );
    const width = roundSize(artifact.defaultSize.width * scale);
    const height = roundSize(artifact.defaultSize.height * scale);
    if (width === node.width && height === node.height) {
      return node;
    }
    changed = true;
    return { ...node, width, height };
  });

  return changed ? nextNodes : nodes;
}
