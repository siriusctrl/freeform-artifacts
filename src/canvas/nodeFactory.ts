import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { ArtifactBundle } from "../artifacts/generated/bundles";
import type { ArtifactNodePreset } from "./artifactCatalog";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import { screenToWorld } from "../lib/geometry";

interface ArtifactNodePlacement {
  stageSize?: { width: number; height: number };
  center?: { x: number; y: number };
  position?: { x: number; y: number };
  respectPresetPosition?: boolean;
}

export interface ArtifactPlacementBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type PositionedArtifactNodePreset = ArtifactNodePreset & { x?: number; y?: number };

export function createArtifactNode(
  preset: PositionedArtifactNodePreset,
  artifact: RegisteredArtifact,
  targetNodes: CanvasNode[],
  targetViewport: CanvasViewport,
  placement: ArtifactNodePlacement = {},
): CanvasNode {
  const center = placement.center ?? (placement.stageSize
    ? screenToWorld({ x: placement.stageSize.width / 2, y: placement.stageSize.height / 2 }, targetViewport)
    : { x: 260, y: 200 });
  const presetPosition = placement.respectPresetPosition && preset.x !== undefined && preset.y !== undefined
    ? { x: preset.x, y: preset.y }
    : undefined;
  const position = placement.position ?? presetPosition;
  return {
    id: `node-${artifact.id}-${crypto.randomUUID().slice(0, 8)}`,
    artifactId: artifact.id,
    title: preset.title,
    x: position?.x ?? Math.round(center.x - artifact.defaultSize.width / 2),
    y: position?.y ?? Math.round(center.y - artifact.defaultSize.height / 2),
    width: artifact.defaultSize.width,
    height: artifact.defaultSize.height,
    zIndex: Math.max(0, ...targetNodes.map((node) => node.zIndex)) + 1,
    data: structuredClone(preset.data),
    config: structuredClone(preset.config),
    dataBinding: preset.dataBinding ? structuredClone(preset.dataBinding) : undefined,
  };
}

export function nodesOverlap(first: CanvasNode, second: CanvasNode, gap: number) {
  return first.x < second.x + second.width + gap &&
    first.x + first.width + gap > second.x &&
    first.y < second.y + second.height + gap &&
    first.y + first.height + gap > second.y;
}

function snappedRange(minimum: number, maximum: number, itemSize: number, gridSize: number) {
  return {
    min: Math.ceil(minimum / gridSize) * gridSize,
    max: Math.floor((maximum - itemSize) / gridSize) * gridSize,
  };
}

export function moveNodeToNearestOpenPosition(
  node: CanvasNode,
  existingNodes: CanvasNode[],
  gridSize: number,
  bounds?: ArtifactPlacementBounds,
) {
  const horizontalRange = bounds ? snappedRange(bounds.left, bounds.right, node.width, gridSize) : undefined;
  const verticalRange = bounds ? snappedRange(bounds.top, bounds.bottom, node.height, gridSize) : undefined;
  const origin = {
    x: horizontalRange && horizontalRange.min <= horizontalRange.max
      ? Math.min(horizontalRange.max, Math.max(horizontalRange.min, node.x))
      : node.x,
    y: verticalRange && verticalRange.min <= verticalRange.max
      ? Math.min(verticalRange.max, Math.max(verticalRange.min, node.y))
      : node.y,
  };
  const positionedNode = { ...node, ...origin };
  if (!existingNodes.some((existing) => nodesOverlap(positionedNode, existing, gridSize))) return positionedNode;

  const fitsBounds = (candidate: CanvasNode) => {
    const fitsHorizontally = !horizontalRange || horizontalRange.min > horizontalRange.max ||
      (candidate.x >= horizontalRange.min && candidate.x <= horizontalRange.max);
    const fitsVertically = !verticalRange || verticalRange.min > verticalRange.max ||
      (candidate.y >= verticalRange.min && candidate.y <= verticalRange.max);
    return fitsHorizontally && fitsVertically;
  };
  const maxRadius = bounds
    ? Math.max(24, Math.ceil(Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) / gridSize))
    : 24;
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
        const candidate = { ...node, x: origin.x + x * gridSize, y: origin.y + y * gridSize };
        if (!fitsBounds(candidate)) continue;
        if (!existingNodes.some((existing) => nodesOverlap(candidate, existing, gridSize))) return candidate;
      }
    }
  }
  return positionedNode;
}

export function createBundleNode(
  bundle: ArtifactBundle,
  artifact: RegisteredArtifact,
  targetNodes: CanvasNode[],
  targetViewport: CanvasViewport,
  stageSize?: { width: number; height: number },
): CanvasNode {
  return createArtifactNode(bundle.node, artifact, targetNodes, targetViewport, {
    stageSize,
    respectPresetPosition: true,
  });
}
