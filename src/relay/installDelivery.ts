import {
  ArtifactBundleValidationError,
  prepareArtifactBundle,
} from "../artifacts/generated/bundles";
import { validatePreparedArtifact } from "../artifacts/generated/preflight";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode } from "../artifacts/types";
import { CANVAS_GRID_SIZE, snapToGrid } from "../lib/geometry";
import {
  commitWorkspaceWithArtifactPackages,
  loadWorkspaceById,
  relayReceiptId,
  WorkspaceConflictError,
  WorkspaceDeletedError,
} from "../workspaces/storage";
import type { WorkspaceRecord } from "../workspaces/types";
import type {
  PreparedRelayDelivery,
  RelayDeliveryIdentity,
  RelayPlacementContext,
  RelayPreparedArtifacts,
} from "./types";
import { createArtifactNode, moveNodeToNearestOpenPosition, nodesOverlap } from "../canvas/nodeFactory";

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

function fallbackGridOffset(index: number) {
  if (index === 0) return { x: 0, y: 0 };
  let remaining = index;
  for (let radius = 1; ; radius += 1) {
    const ring: Array<{ x: number; y: number }> = [];
    for (let x = radius; x >= -radius; x -= 1) ring.push({ x, y: radius });
    for (let y = radius - 1; y >= -radius; y -= 1) ring.push({ x: -radius, y });
    for (let x = -radius + 1; x <= radius; x += 1) ring.push({ x, y: -radius });
    for (let y = -radius + 1; y < radius; y += 1) ring.push({ x: radius, y });
    if (remaining <= ring.length) return ring[remaining - 1];
    remaining -= ring.length;
  }
}

function visibleTopLeftRange(
  minimum: number,
  maximum: number,
  itemSize: number,
  gridSize: number,
) {
  const visibleSize = Math.min(gridSize, itemSize, Math.max(0, maximum - minimum));
  return {
    min: Math.ceil((minimum - itemSize + visibleSize) / gridSize) * gridSize,
    max: Math.floor((maximum - visibleSize) / gridSize) * gridSize,
  };
}

function centeredSnappedStart(minimum: number, maximum: number, size: number, gridSize: number) {
  const snappedMinimum = Math.ceil(minimum / gridSize) * gridSize;
  const snappedMaximum = Math.floor((maximum - size) / gridSize) * gridSize;
  if (snappedMinimum > snappedMaximum) return null;
  const centered = Math.round(((minimum + maximum - size) / 2) / gridSize) * gridSize;
  return Math.min(snappedMaximum, Math.max(snappedMinimum, centered));
}

function preferredDeliveryPositions(
  prepared: RelayPreparedArtifacts,
  bounds: ReturnType<typeof visibleBounds>,
  gridSize: number,
) {
  if (prepared.artifacts.length <= 1) return [];
  const maximumWidth = Math.max(...prepared.artifacts.map((artifact) => artifact.defaultSize.width));
  const maximumHeight = Math.max(...prepared.artifacts.map((artifact) => artifact.defaultSize.height));
  const cellWidth = Math.ceil((maximumWidth + gridSize) / gridSize) * gridSize;
  const cellHeight = Math.ceil((maximumHeight + gridSize) / gridSize) * gridSize;
  const availableWidth = bounds.right - bounds.left;
  const availableHeight = bounds.bottom - bounds.top;
  const maximumColumns = Math.min(
    prepared.artifacts.length,
    Math.max(1, Math.floor((availableWidth + gridSize) / cellWidth)),
  );

  for (let columns = maximumColumns; columns >= 1; columns -= 1) {
    const rows = Math.ceil(prepared.artifacts.length / columns);
    const groupWidth = (columns - 1) * cellWidth + maximumWidth;
    const groupHeight = (rows - 1) * cellHeight + maximumHeight;
    if (groupWidth > availableWidth || groupHeight > availableHeight) continue;
    const startX = centeredSnappedStart(bounds.left, bounds.right, groupWidth, gridSize);
    const startY = centeredSnappedStart(bounds.top, bounds.bottom, groupHeight, gridSize);
    if (startX === null || startY === null) continue;
    return prepared.artifacts.map((_, index) => ({
      x: startX + (index % columns) * cellWidth,
      y: startY + Math.floor(index / columns) * cellHeight,
    }));
  }
  return [];
}

function moveNodeToViewportFallback(
  node: CanvasNode,
  fallbackIndex: number,
  previousFallbacks: CanvasNode[],
  bounds: ReturnType<typeof visibleBounds>,
  gridSize: number,
) {
  const horizontal = visibleTopLeftRange(bounds.left, bounds.right, node.width, gridSize);
  const vertical = visibleTopLeftRange(bounds.top, bounds.bottom, node.height, gridSize);
  let firstCandidate: CanvasNode | undefined;
  for (let index = fallbackIndex; index < fallbackIndex + 256; index += 1) {
    const offset = fallbackGridOffset(index);
    const candidate = {
      ...node,
      x: Math.min(horizontal.max, Math.max(horizontal.min, node.x + offset.x * gridSize)),
      y: Math.min(vertical.max, Math.max(vertical.min, node.y + offset.y * gridSize)),
    };
    firstCandidate ??= candidate;
    if (!previousFallbacks.some((previous) => previous.x === candidate.x && previous.y === candidate.y)) {
      return candidate;
    }
  }
  return firstCandidate ?? node;
}

export async function prepareRelayArtifacts(
  values: unknown[],
  existingRegistry: Record<string, RegisteredArtifact>,
): Promise<RelayPreparedArtifacts> {
  if (!values.length) throw new Error("A relay delivery must contain at least one artifact");
  const registry = { ...existingRegistry };
  const prepared: RelayPreparedArtifacts = { artifacts: [], bundles: [] };
  const selectionIds = new Set<string>();
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
    if (selectionIds.has(entry.artifact.id)) {
      throw new RelayDeliveryRejectedError(
        `Artifact id ${entry.artifact.id} appears more than once in this delivery`,
      );
    }
    selectionIds.add(entry.artifact.id);
    registry[entry.artifact.id] = entry.artifact;
    prepared.artifacts.push(entry.artifact);
    prepared.bundles.push(entry.bundle);
  }
  return prepared;
}

export function placePreparedRelayArtifacts(
  prepared: RelayPreparedArtifacts,
  workspace: WorkspaceRecord,
  placement: RelayPlacementContext,
): PreparedRelayDelivery {
  const targetNodes = [...workspace.board.nodes];
  const addedNodes: CanvasNode[] = [];
  const bounds = visibleBounds(workspace, placement.stageSize);
  const preferredPositions = preferredDeliveryPositions(prepared, bounds, CANVAS_GRID_SIZE);
  let fallbackCount = 0;
  for (let index = 0; index < prepared.artifacts.length; index += 1) {
    const artifact = prepared.artifacts[index];
    const bundle = prepared.bundles[index];
    let node = createArtifactNode(
      bundle.node,
      artifact,
      targetNodes,
      workspace.board.viewport,
      { stageSize: placement.stageSize, position: preferredPositions[index] },
    );
    node = { ...node, x: snapToGrid(node.x), y: snapToGrid(node.y) };
    const openPosition = moveNodeToNearestOpenPosition(node, targetNodes, CANVAS_GRID_SIZE, bounds);
    const hasCompleteOpening = nodeFitsCompletelyInBounds(openPosition, bounds) &&
      !targetNodes.some((existing) => nodesOverlap(openPosition, existing, CANVAS_GRID_SIZE));
    if (hasCompleteOpening) {
      node = openPosition;
    } else {
      node = moveNodeToViewportFallback(node, fallbackCount, addedNodes, bounds, CANVAS_GRID_SIZE);
      fallbackCount += 1;
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
    artifacts: prepared.artifacts,
    bundles: prepared.bundles,
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

const MAX_STORED_INSTALL_ATTEMPTS = 3;

export async function installPreparedRelayDeliveryIntoStoredView(
  targetViewId: string,
  targetViewIncarnationId: string,
  preparedArtifacts: RelayPreparedArtifacts,
  placement: RelayPlacementContext,
  identity: RelayDeliveryIdentity,
) : Promise<PreparedRelayDelivery> {
  for (let attempt = 0; attempt < MAX_STORED_INSTALL_ATTEMPTS; attempt += 1) {
    if (identity.signal.aborted) {
      throw new DOMException("Build Session is no longer active", "AbortError");
    }
    const target = await loadWorkspaceById(targetViewId);
    if (!target) throw new RelayDeliveryRejectedError("Target canvas view no longer exists");
    if (target.workspace.incarnationId !== targetViewIncarnationId) {
      throw new RelayDeliveryRejectedError("Target canvas view was deleted or replaced after this Build Session opened");
    }
    const placed = placePreparedRelayArtifacts(preparedArtifacts, target.workspace, placement);
    try {
      const committed = await commitWorkspaceWithArtifactPackages(placed.workspace, placed.bundles, {
        id: relayReceiptId(identity.sessionId, identity.deliveryId),
        deliveryId: identity.deliveryId,
        sessionId: identity.sessionId,
        targetViewId,
        targetViewIncarnationId,
        artifactIds: placed.artifacts.map((artifact) => artifact.id),
        nodeIds: placed.nodes.map((node) => node.id),
        installedAt: new Date().toISOString(),
      }, {
        expectedIncarnationId: targetViewIncarnationId,
        expectedRevision: target.workspace.revision,
        signal: identity.signal,
      });
      return { ...placed, workspace: committed.workspace };
    } catch (error) {
      if (error instanceof WorkspaceDeletedError) {
        throw new RelayDeliveryRejectedError("Target canvas view no longer exists");
      }
      if (error instanceof WorkspaceConflictError && attempt + 1 < MAX_STORED_INSTALL_ATTEMPTS) {
        continue;
      }
      if (error instanceof WorkspaceConflictError) {
        throw new RelayDeliveryRejectedError(
          "Target canvas changed repeatedly during delivery; retry after edits settle",
        );
      }
      throw error;
    }
  }
  throw new RelayDeliveryRejectedError("Unable to install this delivery safely");
}
