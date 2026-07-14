import {
  ArtifactBundleValidationError,
  loadInstalledArtifacts,
  prepareArtifactBundle,
  type ArtifactBundle,
} from "../artifacts/generated/bundles";
import { validatePreparedArtifact } from "../artifacts/generated/preflight";
import { artifactRegistry } from "../artifacts/registry";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode } from "../artifacts/types";
import { CANVAS_GRID_SIZE, snapToGrid } from "../lib/geometry";
import {
  commitWorkspaceWithArtifactPackages,
  loadWorkspaceById,
  relayReceiptId,
  WorkspaceDeletedError,
} from "../workspaces/storage";
import type { WorkspaceRecord } from "../workspaces/types";
import type { RelayDeliveryIdentity } from "./types";
import { createArtifactNode, moveNodeToNearestOpenPosition, nodesOverlap } from "../canvas/nodeFactory";

export interface RelayPlacementContext {
  stageSize: { width: number; height: number };
}

export interface PreparedRelayDelivery {
  artifacts: RegisteredArtifact[];
  bundles: ArtifactBundle[];
  nodes: CanvasNode[];
  workspace: WorkspaceRecord;
}

export class RelayDeliveryRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayDeliveryRejectedError";
  }
}

function visibleBounds(workspace: WorkspaceRecord, stageSize: RelayPlacementContext["stageSize"]) {
  const { viewport } = workspace.board;
  return {
    left: -viewport.x / viewport.scale,
    right: (stageSize.width - viewport.x) / viewport.scale,
    top: -viewport.y / viewport.scale,
    bottom: (stageSize.height - viewport.y) / viewport.scale,
  };
}

function nodeFitsCompletelyInBounds(node: CanvasNode, bounds: ReturnType<typeof visibleBounds>) {
  return node.x >= bounds.left && node.y >= bounds.top &&
    node.x + node.width <= bounds.right && node.y + node.height <= bounds.bottom;
}

function axisOverlaps(
  candidateStart: number,
  candidateSize: number,
  existingStart: number,
  existingSize: number,
  gap: number,
) {
  return candidateStart < existingStart + existingSize + gap &&
    candidateStart + candidateSize + gap > existingStart;
}

interface GridInterval {
  start: number;
  end: number;
}

function nearestUnblockedGridIndex(origin: number, intervals: GridInterval[]) {
  if (!intervals.length) return origin;
  const sorted = [...intervals].sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: GridInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end + 1) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  const containing = merged.find((interval) => origin >= interval.start && origin <= interval.end);
  if (!containing) return origin;
  const before = containing.start - 1;
  const after = containing.end + 1;
  return origin - before <= after - origin ? before : after;
}

/**
 * Find the nearest free grid position in the unbounded canvas world.
 *
 * Each existing node creates a rectangular set of forbidden top-left positions.
 * The nearest free position must be either on the origin row or immediately
 * outside one of those rectangles, so only those rows need to be examined. For
 * each row, merging the forbidden column intervals gives the nearest free
 * column without an unbounded ring walk for unusually large artifacts.
 */
function moveNodeToNearestOpenWorldPosition(
  node: CanvasNode,
  existingNodes: CanvasNode[],
  gridSize: number,
) {
  const originX = Math.round(node.x / gridSize);
  const originY = Math.round(node.y / gridSize);
  const candidateRows = new Set<number>([originY]);
  for (const existing of existingNodes) {
    const forbiddenTop = existing.y - node.height - gridSize;
    const forbiddenBottom = existing.y + existing.height + gridSize;
    candidateRows.add(Math.floor(forbiddenTop / gridSize));
    candidateRows.add(Math.ceil(forbiddenBottom / gridSize));
  }

  let best: { node: CanvasNode; radius: number; row: number; column: number } | undefined;
  for (const row of candidateRows) {
    const y = row * gridSize;
    const forbiddenColumns: GridInterval[] = [];
    for (const existing of existingNodes) {
      if (!axisOverlaps(y, node.height, existing.y, existing.height, gridSize)) continue;
      const forbiddenLeft = existing.x - node.width - gridSize;
      const forbiddenRight = existing.x + existing.width + gridSize;
      const start = Math.floor(forbiddenLeft / gridSize) + 1;
      const end = Math.ceil(forbiddenRight / gridSize) - 1;
      if (start <= end) forbiddenColumns.push({ start, end });
    }
    const column = nearestUnblockedGridIndex(originX, forbiddenColumns);
    const candidate = { ...node, x: column * gridSize, y };
    if (existingNodes.some((existing) => nodesOverlap(candidate, existing, gridSize))) continue;
    const radius = Math.max(Math.abs(column - originX), Math.abs(row - originY));
    if (!best || radius < best.radius || (
      radius === best.radius && (row < best.row || (row === best.row && column < best.column))
    )) {
      best = { node: candidate, radius, row, column };
    }
  }

  // The origin row is always examined, and a column beyond every finite
  // blocker is always available, so valid artifact dimensions guarantee this.
  if (!best) throw new RelayDeliveryRejectedError("Unable to find a safe canvas position");
  return best.node;
}

export async function prepareRelayDelivery(
  values: unknown[],
  workspace: WorkspaceRecord,
  existingRegistry: Record<string, RegisteredArtifact>,
  placement: RelayPlacementContext,
): Promise<PreparedRelayDelivery> {
  if (!values.length) throw new Error("A relay delivery must contain at least one artifact");
  const registry = { ...existingRegistry };
  const prepared: Array<{ artifact: RegisteredArtifact; bundle: ArtifactBundle }> = [];
  for (const value of values) {
    let entry;
    try {
      entry = await prepareArtifactBundle(value, registry);
    } catch (error) {
      if (error instanceof ArtifactBundleValidationError) {
        throw new RelayDeliveryRejectedError(error.message);
      }
      throw error;
    }
    registry[entry.artifact.id] = entry.artifact;
    prepared.push(entry);
  }

  const targetNodes = [...workspace.board.nodes];
  const addedNodes: CanvasNode[] = [];
  const bounds = visibleBounds(workspace, placement.stageSize);
  for (const { artifact, bundle } of prepared) {
    let node = createArtifactNode(
      bundle.node,
      artifact,
      targetNodes,
      workspace.board.viewport,
      { stageSize: placement.stageSize },
    );
    node = { ...node, x: snapToGrid(node.x), y: snapToGrid(node.y) };
    const openPosition = moveNodeToNearestOpenPosition(node, targetNodes, CANVAS_GRID_SIZE, bounds);
    const hasCompleteOpening = nodeFitsCompletelyInBounds(openPosition, bounds) &&
      !targetNodes.some((existing) => nodesOverlap(openPosition, existing, CANVAS_GRID_SIZE));
    if (hasCompleteOpening) {
      node = openPosition;
    } else {
      node = moveNodeToNearestOpenWorldPosition(node, targetNodes, CANVAS_GRID_SIZE);
    }
    try {
      validatePreparedArtifact(node, artifact);
    } catch (error) {
      throw new RelayDeliveryRejectedError(
        error instanceof Error ? error.message : "Artifact preflight failed",
      );
    }
    targetNodes.push(node);
    addedNodes.push(node);
  }

  const selectedNodeId = addedNodes.at(-1)?.id ?? workspace.board.selectedNodeId;
  return {
    artifacts: prepared.map((entry) => entry.artifact),
    bundles: prepared.map((entry) => entry.bundle),
    nodes: addedNodes,
    workspace: {
      ...workspace,
      updatedAt: new Date().toISOString(),
      board: {
        ...workspace.board,
        nodes: targetNodes,
        selectedNodeId,
      },
    },
  };
}

export async function installRelayDeliveryIntoStoredView(
  targetViewId: string,
  values: unknown[],
  placement: RelayPlacementContext,
  identity: RelayDeliveryIdentity,
) {
  const target = await loadWorkspaceById(targetViewId);
  if (!target) throw new RelayDeliveryRejectedError("Target canvas view no longer exists");
  const installed = await loadInstalledArtifacts();
  const prepared = await prepareRelayDelivery(
    values,
    target.workspace,
    { ...artifactRegistry, ...installed.registry },
    placement,
  );
  try {
    await commitWorkspaceWithArtifactPackages(prepared.workspace, prepared.bundles, {
      id: relayReceiptId(identity.sessionId, identity.deliveryId),
      deliveryId: identity.deliveryId,
      sessionId: identity.sessionId,
      targetViewId,
      artifactIds: prepared.artifacts.map((artifact) => artifact.id),
      nodeIds: prepared.nodes.map((node) => node.id),
      installedAt: new Date().toISOString(),
    }, { signal: identity.signal });
  } catch (error) {
    if (error instanceof WorkspaceDeletedError) {
      throw new RelayDeliveryRejectedError("Target canvas view no longer exists");
    }
    throw error;
  }
  return prepared;
}
