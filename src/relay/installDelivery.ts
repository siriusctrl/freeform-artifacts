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
  let fallbackIndex = 0;
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
      node = {
        ...node,
        x: node.x + fallbackIndex * CANVAS_GRID_SIZE,
        y: node.y + fallbackIndex * CANVAS_GRID_SIZE,
      };
      fallbackIndex += 1;
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
  if (!target) throw new Error(`Unknown canvas view: ${targetViewId}`);
  const installed = await loadInstalledArtifacts();
  const prepared = await prepareRelayDelivery(
    values,
    target.workspace,
    { ...artifactRegistry, ...installed.registry },
    placement,
  );
  await commitWorkspaceWithArtifactPackages(prepared.workspace, prepared.bundles, {
    id: relayReceiptId(identity.sessionId, identity.deliveryId),
    deliveryId: identity.deliveryId,
    sessionId: identity.sessionId,
    targetViewId,
    artifactIds: prepared.artifacts.map((artifact) => artifact.id),
    nodeIds: prepared.nodes.map((node) => node.id),
    installedAt: new Date().toISOString(),
  }, { signal: identity.signal });
  return prepared;
}
