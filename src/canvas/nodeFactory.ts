import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { ArtifactBundle } from "../artifacts/generated/bundles";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import { screenToWorld } from "../lib/geometry";

export function createBundleNode(
  bundle: ArtifactBundle,
  artifact: RegisteredArtifact,
  targetNodes: CanvasNode[],
  targetViewport: CanvasViewport,
  stageSize?: { width: number; height: number },
): CanvasNode {
  const center = stageSize
    ? screenToWorld({ x: stageSize.width / 2, y: stageSize.height / 2 }, targetViewport)
    : { x: 260, y: 200 };
  return {
    id: `node-${artifact.id}-${crypto.randomUUID().slice(0, 8)}`,
    artifactId: artifact.id,
    title: bundle.node.title,
    x: bundle.node.x ?? Math.round(center.x - artifact.defaultSize.width / 2),
    y: bundle.node.y ?? Math.round(center.y - artifact.defaultSize.height / 2),
    width: artifact.defaultSize.width,
    height: artifact.defaultSize.height,
    zIndex: Math.max(0, ...targetNodes.map((node) => node.zIndex)) + 1,
    data: bundle.node.data,
    config: bundle.node.config,
  };
}
