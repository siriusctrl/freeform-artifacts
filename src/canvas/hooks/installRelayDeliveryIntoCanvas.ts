import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ArtifactBundle } from "../../artifacts/generated/bundles";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasViewport } from "../../artifacts/types";
import { placePreparedRelayArtifacts, RelayDeliveryRejectedError } from "../../relay/installDelivery";
import type {
  RelayDeliveryIdentity,
  RelayPlacementContext,
  RelayPreparedArtifacts,
} from "../../relay/types";
import {
  commitWorkspaceWithArtifactPackages,
  loadWorkspaceById,
  relayReceiptId,
  WorkspaceConflictError,
  WorkspaceDeletedError,
} from "../../workspaces/storage";
import type { WorkspaceLoadResult, WorkspaceRecord } from "../../workspaces/types";
import type { ThemeMode } from "../constants";
import { clampNodesToArtifactMinimums } from "../nodeSize";
import type { CanvasDocumentSnapshot } from "./useCanvasDocumentHistory";

interface CanvasRelayBindings {
  commitExternalDocument: (baseline: CanvasDocumentSnapshot, next: CanvasDocumentSnapshot) => void;
  stageRef: RefObject<HTMLDivElement | null>;
  workspaceRef: RefObject<WorkspaceRecord>;
}

interface RelayPersistenceBindings {
  cancelPendingSave: () => void;
  flushPendingSave: () => Promise<unknown>;
  skipNextSave: () => void;
}

interface RelayRuntimeBindings {
  setPersonalBundles: Dispatch<SetStateAction<ArtifactBundle[]>>;
  setRegistry: Dispatch<SetStateAction<Record<string, RegisteredArtifact>>>;
}

interface RelayStateBindings {
  setSnapToGrid: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setStorageMode: Dispatch<SetStateAction<WorkspaceLoadResult["storage"]>>;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  setViewTitle: Dispatch<SetStateAction<string>>;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  setWorkspaceCommitId: Dispatch<SetStateAction<string>>;
  setWorkspaceRevision: Dispatch<SetStateAction<number>>;
}

interface InstallRelayDeliveryIntoCanvasOptions {
  activeView: {
    id: string;
    incarnationId: string;
  };
  canvas: CanvasRelayBindings;
  identity: RelayDeliveryIdentity;
  persistence: RelayPersistenceBindings;
  placement: RelayPlacementContext;
  preparedArtifacts: RelayPreparedArtifacts;
  registryRef: RefObject<Record<string, RegisteredArtifact>>;
  runtime: RelayRuntimeBindings;
  state: RelayStateBindings;
}

function stageSizeFor(stageRef: RefObject<HTMLDivElement | null>) {
  const stageRect = stageRef.current?.getBoundingClientRect();
  return stageRect ? { width: stageRect.width, height: stageRect.height } : undefined;
}

export async function installRelayDeliveryIntoCanvas({
  activeView,
  canvas,
  identity,
  persistence,
  placement,
  preparedArtifacts,
  registryRef,
  runtime,
  state,
}: InstallRelayDeliveryIntoCanvasOptions) {
  await persistence.flushPendingSave();
  const localStageSize = stageSizeFor(canvas.stageRef);
  let prepared = null;
  let baseWorkspace = canvas.workspaceRef.current;
  let committed = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (identity.signal.aborted) throw new DOMException("Build Session is no longer active", "AbortError");
    if (baseWorkspace.incarnationId !== activeView.incarnationId) throw replacedViewError();

    prepared = placePreparedRelayArtifacts(preparedArtifacts, baseWorkspace, {
      stageSize: localStageSize ?? placement.stageSize,
    });
    persistence.cancelPendingSave();
    try {
      committed = await commitWorkspaceWithArtifactPackages(prepared.workspace, prepared.bundles, {
        id: relayReceiptId(identity.sessionId, identity.deliveryId),
        deliveryId: identity.deliveryId,
        sessionId: identity.sessionId,
        targetViewId: activeView.id,
        targetViewIncarnationId: activeView.incarnationId,
        artifactIds: prepared.artifacts.map((artifact) => artifact.id),
        nodeIds: prepared.nodes.map((node) => node.id),
        installedAt: new Date().toISOString(),
      }, {
        expectedIncarnationId: baseWorkspace.incarnationId,
        expectedRevision: baseWorkspace.revision,
        signal: identity.signal,
      });
      break;
    } catch (error) {
      if (error instanceof WorkspaceDeletedError) {
        throw new RelayDeliveryRejectedError("Target canvas view no longer exists");
      }
      if (!(error instanceof WorkspaceConflictError)) throw error;
      const latest = await loadWorkspaceById(activeView.id);
      if (!latest || latest.workspace.incarnationId !== activeView.incarnationId) {
        throw replacedViewError();
      }
      if (attempt === 2) {
        throw new RelayDeliveryRejectedError(
          "Target canvas changed repeatedly during delivery; retry after edits settle",
        );
      }
      baseWorkspace = latest.workspace;
    }
  }

  if (!prepared || !committed) {
    throw new RelayDeliveryRejectedError("Unable to install this delivery safely");
  }

  const artifactIds = prepared.artifacts.map((artifact) => artifact.id);
  const nodeIds = prepared.nodes.map((node) => node.id);
  persistence.skipNextSave();
  canvas.workspaceRef.current = committed.workspace;
  const deliveredRegistry = Object.fromEntries(prepared.artifacts.map((artifact) => [artifact.id, artifact]));
  registryRef.current = { ...registryRef.current, ...deliveredRegistry };
  runtime.setRegistry((current) => ({ ...current, ...deliveredRegistry }));
  runtime.setPersonalBundles((current) => {
    const deliveredIds = new Set(prepared.bundles.map((bundle) => bundle.artifactId));
    return [...current.filter((bundle) => !deliveredIds.has(bundle.artifactId)), ...prepared.bundles];
  });

  const deliveredNodeIds = new Set(nodeIds);
  const baselineNodes = clampNodesToArtifactMinimums(
    committed.workspace.board.nodes.filter((node) => !deliveredNodeIds.has(node.id)),
    registryRef.current,
  );
  const committedNodes = clampNodesToArtifactMinimums(
    committed.workspace.board.nodes,
    registryRef.current,
  );
  const baselineSelectedNodeId = baseWorkspace.board.selectedNodeId &&
    baselineNodes.some((node) => node.id === baseWorkspace.board.selectedNodeId)
    ? baseWorkspace.board.selectedNodeId
    : "";
  canvas.commitExternalDocument({
    nodes: baselineNodes,
    selectedNodeIds: baselineSelectedNodeId ? [baselineSelectedNodeId] : [],
  }, {
    nodes: committedNodes,
    selectedNodeIds: committed.workspace.board.selectedNodeId
      ? [committed.workspace.board.selectedNodeId]
      : [],
  });
  applyCommittedWorkspaceState(committed.workspace, committed.storage, state);
  state.setStatus(`Installed ${prepared.artifacts.length} artifact${prepared.artifacts.length === 1 ? "" : "s"}`);
  return { artifactIds, nodeIds };
}

function applyCommittedWorkspaceState(
  workspace: WorkspaceRecord,
  storage: WorkspaceLoadResult["storage"],
  state: RelayStateBindings,
) {
  state.setViewport(workspace.board.viewport);
  state.setThemeMode(workspace.board.themeMode);
  state.setSnapToGrid(workspace.board.snapToGrid);
  state.setViewTitle(workspace.title);
  state.setWorkspaceCommitId(workspace.commitId);
  state.setWorkspaceRevision(workspace.revision);
  state.setStorageMode(storage);
}

function replacedViewError() {
  return new RelayDeliveryRejectedError(
    "Target canvas view was deleted or replaced after this Build Session opened",
  );
}
