import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  parseArtifactBundle,
  prepareArtifactBundle,
  type ArtifactBundle,
} from "../../artifacts/generated/bundles";
import { validatePreparedArtifact } from "../../artifacts/generated/preflight";
import { CHART_KIT_CAPABILITIES } from "../../artifacts/chartKit";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "../../artifacts/types";
import type { RelayLiveInstaller } from "../../relay/types";
import {
  commitWorkspaceWithArtifactPackage,
  listWorkspaces,
  loadWorkspaceById,
} from "../../workspaces/storage";
import type { WorkspaceLoadResult, WorkspaceRecord } from "../../workspaces/types";
import { createBoardState } from "../board";
import { createBundleNode } from "../nodeFactory";
import type { ThemeMode } from "../constants";
import { installRelayDeliveryIntoCanvas } from "./installRelayDeliveryIntoCanvas";
import type { CanvasDocumentSnapshot } from "./useCanvasDocumentHistory";

interface ArtifactRuntimeBindings {
  registry: Record<string, RegisteredArtifact>;
  setPersonalBundles: Dispatch<SetStateAction<ArtifactBundle[]>>;
  setRegistry: Dispatch<SetStateAction<Record<string, RegisteredArtifact>>>;
}

interface CanvasDocumentBindings {
  commitDocument: (update: (current: CanvasDocumentSnapshot) => CanvasDocumentSnapshot) => void;
  commitExternalDocument: (baseline: CanvasDocumentSnapshot, next: CanvasDocumentSnapshot) => void;
  nodes: CanvasNode[];
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewport;
  workspaceRef: RefObject<WorkspaceRecord>;
}

interface PersistenceBindings {
  cancelPendingSave: () => void;
  flushPendingSave: () => Promise<unknown>;
  skipNextSave: () => void;
}

interface InstallationStateBindings {
  setSnapToGrid: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setStorageMode: Dispatch<SetStateAction<WorkspaceLoadResult["storage"]>>;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  setViewTitle: Dispatch<SetStateAction<string>>;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  setWorkspaceCommitId: Dispatch<SetStateAction<string>>;
  setWorkspaceRevision: Dispatch<SetStateAction<number>>;
}

interface UseCanvasArtifactInstallationOptions {
  activeView: {
    id: string;
    incarnationId: string;
  };
  canvas: CanvasDocumentBindings;
  onBundleFileInstalled: () => void;
  onRegisterRelayInstaller: (installer: RelayLiveInstaller | null) => void;
  persistence: PersistenceBindings;
  runtime: ArtifactRuntimeBindings;
  state: InstallationStateBindings;
}

interface InstallArtifactResult {
  artifactId: string;
  nodeId: string;
  viewId: string;
}

function stageSizeFor(stageRef: RefObject<HTMLDivElement | null>) {
  const stageRect = stageRef.current?.getBoundingClientRect();
  return stageRect ? { width: stageRect.width, height: stageRect.height } : undefined;
}

export function useCanvasArtifactInstallation({
  activeView,
  canvas,
  onBundleFileInstalled,
  onRegisterRelayInstaller,
  persistence,
  runtime,
  state,
}: UseCanvasArtifactInstallationOptions) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const registryRef = useRef(runtime.registry);
  registryRef.current = runtime.registry;

  const beginInstallation = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const finishInstallation = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
  }, []);

  const validateBundle = useCallback(async (value: unknown) => {
    const { artifact, bundle } = await prepareArtifactBundle(value, runtime.registry);
    const node = createBundleNode(
      bundle,
      artifact,
      canvas.nodes,
      canvas.viewport,
      stageSizeFor(canvas.stageRef),
    );
    const renderChecks = validatePreparedArtifact(node, artifact);
    return {
      artifactId: artifact.id,
      renderer: artifact.renderer ?? "react",
      renderChecks,
      persisted: false as const,
    };
  }, [canvas.nodes, canvas.stageRef, canvas.viewport, runtime.registry]);

  const installBundle = useCallback(async (
    value: unknown,
    options: { viewId?: string } = {},
  ): Promise<InstallArtifactResult> => {
    if (!beginInstallation()) throw new Error("Another artifact installation is already in progress");
    try {
      const { artifact, bundle } = await prepareArtifactBundle(value, runtime.registry);
      const targetViewId = options.viewId ?? activeView.id;
      const stageSize = stageSizeFor(canvas.stageRef);

      if (targetViewId === activeView.id) {
        await persistence.flushPendingSave();
        const currentWorkspace = canvas.workspaceRef.current;
        const node = createBundleNode(
          bundle,
          artifact,
          currentWorkspace.board.nodes,
          currentWorkspace.board.viewport,
          stageSize,
        );
        validatePreparedArtifact(node, artifact);
        const workspace = {
          ...currentWorkspace,
          board: createBoardState({
            nodes: [...currentWorkspace.board.nodes, node],
            viewport: currentWorkspace.board.viewport,
            selectedNodeId: node.id,
            themeMode: currentWorkspace.board.themeMode,
            snapToGrid: currentWorkspace.board.snapToGrid,
          }),
        };
        persistence.cancelPendingSave();
        const committed = await commitWorkspaceWithArtifactPackage(workspace, bundle);
        persistence.skipNextSave();
        canvas.workspaceRef.current = committed.workspace;
        const nextRegistry = { ...registryRef.current, [artifact.id]: artifact };
        registryRef.current = nextRegistry;
        runtime.setRegistry(nextRegistry);
        runtime.setPersonalBundles((current) => [
          ...current.filter((entry) => entry.artifactId !== bundle.artifactId),
          bundle,
        ]);
        canvas.commitDocument(() => ({
          nodes: committed.workspace.board.nodes,
          selectedNodeIds: committed.workspace.board.selectedNodeId
            ? [committed.workspace.board.selectedNodeId]
            : [],
        }));
        applyCommittedWorkspaceState(committed.workspace, committed.storage, state);
        state.setStatus(`Installed ${artifact.title}`);
        return { artifactId: artifact.id, nodeId: node.id, viewId: targetViewId };
      }

      const target = await loadWorkspaceById(targetViewId);
      if (!target) throw new Error(`Unknown canvas view: ${targetViewId}`);
      const node = createBundleNode(
        bundle,
        artifact,
        target.workspace.board.nodes,
        target.workspace.board.viewport,
        stageSize,
      );
      validatePreparedArtifact(node, artifact);
      const workspace = {
        ...target.workspace,
        updatedAt: new Date().toISOString(),
        board: {
          ...target.workspace.board,
          nodes: [...target.workspace.board.nodes, node],
          selectedNodeId: node.id,
        },
      };
      await commitWorkspaceWithArtifactPackage(workspace, bundle);
      registryRef.current = { ...registryRef.current, [artifact.id]: artifact };
      runtime.setRegistry((current) => ({ ...current, [artifact.id]: artifact }));
      runtime.setPersonalBundles((current) => [
        ...current.filter((entry) => entry.artifactId !== bundle.artifactId),
        bundle,
      ]);
      return { artifactId: artifact.id, nodeId: node.id, viewId: targetViewId };
    } finally {
      finishInstallation();
    }
  }, [
    activeView.id,
    beginInstallation,
    canvas.commitDocument,
    canvas.stageRef,
    canvas.workspaceRef,
    finishInstallation,
    persistence.cancelPendingSave,
    persistence.flushPendingSave,
    persistence.skipNextSave,
    runtime.registry,
    runtime.setPersonalBundles,
    runtime.setRegistry,
    state.setSnapToGrid,
    state.setStatus,
    state.setStorageMode,
    state.setThemeMode,
    state.setViewTitle,
    state.setViewport,
    state.setWorkspaceCommitId,
    state.setWorkspaceRevision,
  ]);

  const installBundleFile = useCallback(async (file: File) => {
    try {
      await installBundle(parseArtifactBundle(await file.text()));
      onBundleFileInstalled();
      return null;
    } catch (error) {
      const message = error instanceof Error ? `Install failed: ${error.message}` : "Artifact install failed";
      state.setStatus(message);
      return message;
    }
  }, [installBundle, onBundleFileInstalled, state.setStatus]);

  useEffect(() => {
    const installer: RelayLiveInstaller = {
      viewId: activeView.id,
      viewIncarnationId: activeView.incarnationId,
      syncArtifactCatalog: (preparedArtifacts) => {
        const deliveredRegistry = Object.fromEntries(
          preparedArtifacts.artifacts.map((artifact) => [artifact.id, artifact]),
        );
        registryRef.current = { ...registryRef.current, ...deliveredRegistry };
        runtime.setRegistry((current) => ({ ...current, ...deliveredRegistry }));
        runtime.setPersonalBundles((current) => {
          const deliveredIds = new Set(
            preparedArtifacts.bundles.map((bundle) => bundle.artifactId),
          );
          return [
            ...current.filter((bundle) => !deliveredIds.has(bundle.artifactId)),
            ...preparedArtifacts.bundles,
          ];
        });
      },
      install: async (preparedArtifacts, placement, identity) => {
        if (!beginInstallation()) throw new Error("Another artifact installation is already in progress");
        try {
          return await installRelayDeliveryIntoCanvas({
            activeView,
            canvas,
            identity,
            persistence,
            placement,
            preparedArtifacts,
            registryRef,
            runtime,
            state,
          });
        } finally {
          finishInstallation();
        }
      },
    };
    onRegisterRelayInstaller(installer);
    return () => onRegisterRelayInstaller(null);
  }, [
    activeView.id,
    activeView.incarnationId,
    beginInstallation,
    canvas.commitExternalDocument,
    canvas.stageRef,
    canvas.workspaceRef,
    finishInstallation,
    onRegisterRelayInstaller,
    persistence.cancelPendingSave,
    persistence.flushPendingSave,
    persistence.skipNextSave,
    runtime.setPersonalBundles,
    runtime.setRegistry,
    state.setSnapToGrid,
    state.setStatus,
    state.setStorageMode,
    state.setThemeMode,
    state.setViewTitle,
    state.setViewport,
    state.setWorkspaceCommitId,
    state.setWorkspaceRevision,
  ]);

  useEffect(() => {
    window.__FREEFORM_AGENT__ = {
      activeViewId: activeView.id,
      capabilities: { chartKit: CHART_KIT_CAPABILITIES },
      listViews: listWorkspaces,
      validateArtifact: validateBundle,
      installArtifact: installBundle,
    };
    return () => {
      delete window.__FREEFORM_AGENT__;
    };
  }, [activeView.id, installBundle, validateBundle]);

  return { busy, installBundleFile };
}

function applyCommittedWorkspaceState(
  workspace: WorkspaceRecord,
  storage: WorkspaceLoadResult["storage"],
  state: InstallationStateBindings,
) {
  state.setViewport(workspace.board.viewport);
  state.setThemeMode(workspace.board.themeMode);
  state.setSnapToGrid(workspace.board.snapToGrid);
  state.setViewTitle(workspace.title);
  state.setWorkspaceCommitId(workspace.commitId);
  state.setWorkspaceRevision(workspace.revision);
  state.setStorageMode(storage);
}

declare global {
  interface Window {
    __FREEFORM_AGENT__?: {
      readonly activeViewId: string;
      readonly capabilities: {
        readonly chartKit: typeof CHART_KIT_CAPABILITIES;
      };
      listViews: typeof listWorkspaces;
      validateArtifact: (bundle: unknown) => Promise<{
        artifactId: string;
        renderer: string;
        renderChecks: number;
        persisted: false;
      }>;
      installArtifact: (bundle: unknown, options?: { viewId?: string }) => Promise<InstallArtifactResult>;
    };
  }
}
