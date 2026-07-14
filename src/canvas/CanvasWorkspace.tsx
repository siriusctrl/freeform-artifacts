import { useEffect, useMemo, useRef, useState } from "react";
import { validatePreparedArtifact } from "../artifacts/generated/preflight";
import { artifactRegistry } from "../artifacts/registry";
import { createArtifactCatalog, type ArtifactCatalogItem } from "./artifactCatalog";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasViewport } from "../artifacts/types";
import { useArtifactRuntime } from "../artifacts/useArtifactRuntime";
import { importedRevenueRows } from "../data/transformFixtures";
import { revenueSummaryTransform, revenueTableTransform, runTransform } from "../data/transforms";
import { CANVAS_GRID_SIZE, clientToStage, screenToWorld, snapToGrid as snapWorldToGrid } from "../lib/geometry";
import { downloadWorkspace, parseWorkspace } from "../workspaces/bundle";
import { saveWorkspace } from "../workspaces/storage";
import { useWorkspaceAutosave } from "../workspaces/useWorkspaceAutosave";
import { createWorkspaceFromTemplate } from "../workspaces/templates";
import { createWorkspacePreview } from "../workspaces/preview";
import type { WorkspaceLoadResult, WorkspaceRecord, WorkspaceSummary, WorkspaceTemplate } from "../workspaces/types";
import { createBoardState } from "./board";
import { AgentHandoffDialog } from "./components/AgentHandoffDialog";
import { ArtifactLibrary } from "./components/ArtifactLibrary";
import { CanvasBoard } from "./components/CanvasBoard";
import { CanvasSidebar } from "./components/CanvasSidebar";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { themeFor, type ThemeMode } from "./constants";
import { publishCanvasDebugState } from "./debugState";
import { useCanvasArtifactInstallation } from "./hooks/useCanvasArtifactInstallation";
import { useCanvasInteractions } from "./hooks/useCanvasInteractions";
import { useCanvasDocumentHistory } from "./hooks/useCanvasDocumentHistory";
import { useCanvasSelectionActions } from "./hooks/useCanvasSelectionActions";
import { useCanvasShortcuts } from "./hooks/useCanvasShortcuts";
import { createArtifactNode, moveNodeToNearestOpenPosition } from "./nodeFactory";
import { clampNodesToArtifactMinimums } from "./nodeSize";
import type { RelayLiveInstaller } from "../relay/types";
import type { ArtifactRelayController } from "../relay/useArtifactRelaySession";
import { fitNodesToViewport } from "./selection";

interface CanvasWorkspaceProps {
  externalMutationBusy: boolean;
  initialWorkspace: WorkspaceRecord;
  initialStorage: WorkspaceLoadResult["storage"];
  initialStatus: string;
  template: WorkspaceTemplate;
  views: WorkspaceSummary[];
  sidebarOpen: boolean;
  relay: ArtifactRelayController;
  presentationMode: boolean;
  onCreateView: () => void;
  onDeleteView: (id: string, currentWorkspace?: WorkspaceRecord) => Promise<void>;
  onDuplicateView: (id: string, currentWorkspace?: WorkspaceRecord) => Promise<void>;
  onEnterPresentation: () => void;
  onExitPresentation: () => void;
  onNextPresentationView: () => void;
  onPreviousPresentationView: () => void;
  onReorderView: (sourceId: string, targetId: string) => void;
  onSelectView: (id: string) => void;
  onToggleSidebar: () => void;
  onViewTitleChange: (id: string, title: string) => void;
  onRegisterRelayInstaller: (installer: RelayLiveInstaller | null) => void;
}

export function CanvasWorkspace({
  externalMutationBusy,
  initialWorkspace,
  initialStorage,
  initialStatus,
  template,
  views,
  sidebarOpen,
  relay,
  presentationMode,
  onCreateView,
  onDeleteView,
  onDuplicateView,
  onEnterPresentation,
  onExitPresentation,
  onNextPresentationView,
  onPreviousPresentationView,
  onReorderView,
  onSelectView,
  onToggleSidebar,
  onViewTitleChange,
  onRegisterRelayInstaller,
}: CanvasWorkspaceProps) {
  const normalizedInitialNodes = useMemo(
    () => clampNodesToArtifactMinimums(initialWorkspace.board.nodes, artifactRegistry),
    [initialWorkspace.board.nodes],
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const skipInitialSave = normalizedInitialNodes === initialWorkspace.board.nodes;
  const {
    beginTransaction,
    canRedo,
    canUndo,
    commitDocument,
    commitExternalDocument,
    commitTransaction,
    nodes,
    redo,
    resetDocument,
    selectedNodeIds,
    setNodes,
    setSelectedNodeIds,
    undo,
  } = useCanvasDocumentHistory(normalizedInitialNodes, initialWorkspace.board.selectedNodeId);
  const [viewport, setViewport] = useState<CanvasViewport>(initialWorkspace.board.viewport);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialWorkspace.board.themeMode);
  const [snapToGrid, setSnapToGrid] = useState(initialWorkspace.board.snapToGrid);
  const [viewTitle, setViewTitle] = useState(initialWorkspace.title);
  const [workspaceRevision, setWorkspaceRevision] = useState(initialWorkspace.revision);
  const [workspaceCommitId, setWorkspaceCommitId] = useState(initialWorkspace.commitId);
  const [status, setStatus] = useState(initialStatus);
  const [storageMode, setStorageMode] = useState<WorkspaceLoadResult["storage"]>(initialStorage);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const agentDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const agentDialogFallbackFocusRef = useRef<"artifact-library-toggle" | "relay-session-reopen" | null>(null);
  const [artifactLibraryOpen, setArtifactLibraryOpen] = useState(false);
  const [compactOverlay, setCompactOverlay] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [draggingCatalogItemId, setDraggingCatalogItemId] = useState("");
  const selectedNodeId = selectedNodeIds.at(-1) ?? "";
  const {
    applySelectionLayout,
    copySelection,
    deleteNode,
    deleteSelection,
    duplicateSelection,
    pasteSelection,
    redoChange,
    selectAll,
    undoChange,
  } = useCanvasSelectionActions({
    commitDocument,
    nodes,
    redo,
    selectedNodeIds,
    setSelectedNodeIds,
    setStatus,
    undo,
  });
  const {
    diagnostics: artifactDiagnostics,
    personalBundles,
    registry: runtimeArtifactRegistry,
    setPersonalBundles,
    setRegistry: setRuntimeArtifactRegistry,
  } = useArtifactRuntime(artifactRegistry);
  const artifactIssueStatus = artifactDiagnostics.length
    ? `Loaded with ${artifactDiagnostics.length} artifact issue${artifactDiagnostics.length === 1 ? "" : "s"}`
    : null;

  const canvasTheme = useMemo(() => themeFor(themeMode), [themeMode]);
  const artifactCatalog = useMemo(
    () => createArtifactCatalog(runtimeArtifactRegistry, personalBundles),
    [personalBundles, runtimeArtifactRegistry],
  );

  const workspaceSnapshot = useMemo<WorkspaceRecord>(
    () => ({
      version: 1,
      revision: workspaceRevision,
      incarnationId: initialWorkspace.incarnationId,
      commitId: workspaceCommitId,
      templateId: initialWorkspace.templateId,
      title: viewTitle,
      templateVersion: template.version,
      updatedAt: new Date().toISOString(),
      board: createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid }),
    }),
    [initialWorkspace.incarnationId, initialWorkspace.templateId, nodes, selectedNodeId, snapToGrid, template.version, themeMode, viewTitle, viewport, workspaceCommitId, workspaceRevision],
  );
  const workspaceSnapshotRef = useRef(workspaceSnapshot);
  workspaceSnapshotRef.current = workspaceSnapshot;

  function applyWorkspace(
    workspace: WorkspaceRecord,
    registry: Record<string, RegisteredArtifact> = runtimeArtifactRegistry,
  ) {
    resetDocument(
      clampNodesToArtifactMinimums(workspace.board.nodes, registry),
      workspace.board.selectedNodeId,
    );
    setViewport(workspace.board.viewport);
    setThemeMode(workspace.board.themeMode);
    setSnapToGrid(workspace.board.snapToGrid);
    setViewTitle(workspace.title);
    setWorkspaceCommitId(workspace.commitId);
    setWorkspaceRevision(workspace.revision);
  }

  useEffect(() => {
    if (artifactIssueStatus) setStatus(artifactIssueStatus);
  }, [artifactIssueStatus]);

  useEffect(() => {
    setNodes((current) => clampNodesToArtifactMinimums(current, runtimeArtifactRegistry));
  }, [runtimeArtifactRegistry]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => setStageSize((current) => {
      const next = { width: stage.clientWidth, height: stage.clientHeight };
      return current.width === next.width && current.height === next.height ? current : next;
    });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!presentationMode) return;
    setArtifactLibraryOpen(false);
    setAgentDialogOpen(false);
    setDraggingCatalogItemId("");
    window.requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
  }, [presentationMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompactOverlay(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const { cancelPendingSave, flushPendingSave, resumeRecovery, skipNextSave, suppressRecovery } = useWorkspaceAutosave({
    workspace: workspaceSnapshot,
    skipInitialSave,
    onSaving: () => setStatus("Saving locally"),
    onSaved: ({ storage, workspace }) => {
      workspaceSnapshotRef.current = workspace;
      setWorkspaceCommitId(workspace.commitId);
      setWorkspaceRevision(workspace.revision);
      setStorageMode(storage);
      setStatus(artifactIssueStatus ?? (storage === "indexeddb" ? "Saved locally" : "Saved in browser fallback"));
    },
    onError: setStatus,
  });

  const { busy: artifactInstallBusy, installBundleFile } = useCanvasArtifactInstallation({
    activeView: {
      id: initialWorkspace.templateId,
      incarnationId: initialWorkspace.incarnationId,
    },
    canvas: {
      commitDocument,
      commitExternalDocument,
      nodes,
      stageRef,
      viewport,
      workspaceRef: workspaceSnapshotRef,
    },
    onBundleFileInstalled: (result) => {
      if (result.viewId === initialWorkspace.templateId) closeAgentDialog();
    },
    onRegisterRelayInstaller,
    persistence: {
      cancelPendingSave,
      flushPendingSave,
      skipNextSave,
    },
    runtime: {
      registry: runtimeArtifactRegistry,
      setPersonalBundles,
      setRegistry: setRuntimeArtifactRegistry,
    },
    state: {
      setSnapToGrid,
      setStatus,
      setStorageMode,
      setThemeMode,
      setViewTitle,
      setViewport,
      setWorkspaceCommitId,
      setWorkspaceRevision,
    },
  });
  const uiMutationBusy = artifactInstallBusy || externalMutationBusy;
  const canvasInteractions = useCanvasInteractions({
    artifactRegistry: runtimeArtifactRegistry,
    disabled: presentationMode || uiMutationBusy,
    nodes,
    onMutationCommit: commitTransaction,
    onMutationStart: beginTransaction,
    selectedNodeIds,
    setNodes,
    setSelectedNodeIds,
    setViewport,
    snapToGrid,
    stageRef,
    viewport,
  });

  useEffect(() => {
    publishCanvasDebugState({
      artifactLibraryOpen,
      artifactLibraryCounts: {
        builtIn: artifactCatalog.builtIn.length,
        personal: artifactCatalog.personal.length,
      },
      artifactRegistry: runtimeArtifactRegistry,
      nodes,
      selectedNodeId,
      selectedNodeIds,
      canRedo,
      canUndo,
      presentationMode,
      snapToGrid,
      status,
      storageMode,
      templateId: initialWorkspace.templateId,
      themeMode,
      viewport,
    });
  }, [artifactCatalog, artifactLibraryOpen, canRedo, canUndo, nodes, presentationMode, viewport, selectedNodeId, selectedNodeIds, themeMode, snapToGrid, status, storageMode, runtimeArtifactRegistry, initialWorkspace.templateId]);

  function importData() {
    const summary = runTransform(revenueSummaryTransform, importedRevenueRows);
    const table = runTransform(revenueTableTransform, importedRevenueRows);
    if (!summary.ok || !table.ok) {
      setStatus(`Import failed: ${summary.ok ? table.message : summary.message}`);
      return;
    }

    commitDocument((current) => ({
      selectedNodeIds: ["node-revenue"],
      nodes: current.nodes.map((node) => {
        if (node.dataBinding?.transformId === revenueSummaryTransform.id) {
          return {
            ...node,
            data: summary.data,
            dataBinding: { sourceId: "imported-revenue", transformId: revenueSummaryTransform.id },
          };
        }
        if (node.dataBinding?.transformId === revenueTableTransform.id) {
          return {
            ...node,
            data: table.data,
            dataBinding: { sourceId: "imported-revenue", transformId: revenueTableTransform.id },
          };
        }
        return node;
      }),
    }));
  }

  function exportWorkspace() {
    downloadWorkspace(workspaceSnapshot);
    setStatus("Board-data backup downloaded");
  }

  async function importWorkspace(file: File) {
    try {
      await flushPendingSave();
      cancelPendingSave();
      const imported = parseWorkspace(await file.text());
      const unavailableArtifactIds = [...new Set(
        imported.board.nodes
          .map((node) => node.artifactId)
          .filter((artifactId) => !runtimeArtifactRegistry[artifactId]),
      )];
      if (unavailableArtifactIds.length) {
        throw new Error(
          `Install missing artifact package${unavailableArtifactIds.length === 1 ? "" : "s"} before importing: ${unavailableArtifactIds.join(", ")}`,
        );
      }
      const importedWorkspace = {
        ...imported,
        revision: workspaceSnapshotRef.current.revision,
        incarnationId: initialWorkspace.incarnationId,
        templateId: initialWorkspace.templateId,
        title: viewTitle,
        templateVersion: template.version,
        updatedAt: new Date().toISOString(),
      };
      const workspace = {
        ...importedWorkspace,
        board: {
          ...importedWorkspace.board,
          nodes: clampNodesToArtifactMinimums(importedWorkspace.board.nodes, runtimeArtifactRegistry),
        },
      };
      const saved = await saveWorkspace(workspace);
      skipNextSave();
      workspaceSnapshotRef.current = saved.workspace;
      applyWorkspace(saved.workspace);
      setStorageMode(saved.storage);
      setStatus("Workspace backup restored");
    } catch (error) {
      setStatus(error instanceof Error ? `Import failed: ${error.message}` : "Workspace import failed");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  function resetWorkspace() {
    if (!window.confirm("Replace this browser's workspace with the original demo?")) {
      return;
    }
    const workspace = createWorkspaceFromTemplate(template, { id: initialWorkspace.templateId, title: viewTitle });
    commitDocument(() => ({
      nodes: clampNodesToArtifactMinimums(workspace.board.nodes, runtimeArtifactRegistry),
      selectedNodeIds: workspace.board.selectedNodeId ? [workspace.board.selectedNodeId] : [],
    }));
    setViewport(workspace.board.viewport);
    setThemeMode(workspace.board.themeMode);
    setSnapToGrid(workspace.board.snapToGrid);
    setStatus("Demo restored in this browser");
  }

  function resetView() {
    canvasInteractions.resetView();
  }

  function toggleSnapToGrid() {
    setSnapToGrid((current) => !current);
  }

  function toggleViews() {
    const restoringFocus = sidebarOpen;
    setArtifactLibraryOpen(false);
    setDraggingCatalogItemId("");
    void onToggleSidebar();
    if (restoringFocus) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]')?.focus();
      });
    }
  }

  function toggleArtifactLibrary() {
    const opening = !artifactLibraryOpen;
    setArtifactLibraryOpen(opening);
    setDraggingCatalogItemId("");
    if (opening && sidebarOpen) void onToggleSidebar();
  }

  function closeArtifactLibrary(restoreToolbarFocus = false) {
    setArtifactLibraryOpen(false);
    setDraggingCatalogItemId("");
    if (restoreToolbarFocus) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('[data-testid="artifact-library-toggle"]')?.focus();
      });
    }
  }

  function addCatalogItem(item: ArtifactCatalogItem, clientPoint?: { x: number; y: number }) {
    const artifact = runtimeArtifactRegistry[item.artifactId];
    if (!artifact) {
      setStatus(`Artifact unavailable: ${item.title}`);
      return;
    }
    const stageRect = stageRef.current?.getBoundingClientRect();
    const center = clientPoint && stageRect
      ? screenToWorld(clientToStage(clientPoint, stageRect), viewport)
      : undefined;
    let node = createArtifactNode(item.node, artifact, nodes, viewport, {
      center,
      stageSize: stageRect ? { width: stageRect.width, height: stageRect.height } : undefined,
    });
    if (snapToGrid) {
      node.x = snapWorldToGrid(node.x);
      node.y = snapWorldToGrid(node.y);
    }
    if (!clientPoint) {
      const visibleBounds = stageRect ? {
        left: -viewport.x / viewport.scale,
        right: (stageRect.width - viewport.x) / viewport.scale,
        top: -viewport.y / viewport.scale,
        bottom: (stageRect.height - viewport.y) / viewport.scale,
      } : undefined;
      node = moveNodeToNearestOpenPosition(node, nodes, CANVAS_GRID_SIZE, visibleBounds);
    }
    validatePreparedArtifact(node, artifact);
    commitDocument((current) => ({
      nodes: [...current.nodes, node],
      selectedNodeIds: [node.id],
    }));
    closeArtifactLibrary();
    setStatus(`Added ${item.title}`);
    window.requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
  }

  function findCatalogItem(id: string) {
    return [...artifactCatalog.builtIn, ...artifactCatalog.personal].find((item) => item.id === id);
  }

  useCanvasShortcuts({
    artifactLibraryOpen,
    disabled: agentDialogOpen || uiMutationBusy,
    presentationMode,
    selectedNodeIds,
    onCopy: copySelection,
    onDeleteSelection: deleteSelection,
    onDismiss: () => {
      if (artifactLibraryOpen) closeArtifactLibrary(true);
      else if (sidebarOpen) void onToggleSidebar();
      else setSelectedNodeIds([]);
    },
    onDuplicate: duplicateSelection,
    onExitPresentation,
    onNextView: onNextPresentationView,
    onPaste: pasteSelection,
    onPreviousView: onPreviousPresentationView,
    onRedo: redoChange,
    onResetView: resetView,
    onSelectAll: selectAll,
    onToggleArtifacts: toggleArtifactLibrary,
    onToggleViews: toggleViews,
    onUndo: undoChange,
    onZoomIn: () => canvasInteractions.changeZoom(1.15),
    onZoomOut: () => canvasInteractions.changeZoom(0.85),
  });

  function openBuildSession() {
    const stageRect = stageRef.current?.getBoundingClientRect();
    relay.requestSession({
      targetViewId: initialWorkspace.templateId,
      targetViewIncarnationId: initialWorkspace.incarnationId,
      targetViewTitle: viewTitle,
      stageSize: stageRect
        ? { width: stageRect.width, height: stageRect.height }
        : { width: window.innerWidth, height: window.innerHeight },
    });
    setArtifactLibraryOpen(false);
    openAgentDialog();
  }

  function openAgentDialog() {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    agentDialogReturnFocusRef.current = activeElement;
    agentDialogFallbackFocusRef.current = activeElement?.closest(".artifact-library-slot")
      ? "artifact-library-toggle"
      : activeElement?.matches('[data-testid="relay-session-reopen"]')
        ? "relay-session-reopen"
        : null;
    setAgentDialogOpen(true);
  }

  function closeAgentDialog() {
    setAgentDialogOpen(false);
    window.requestAnimationFrame(() => {
      const returnTarget = agentDialogReturnFocusRef.current;
      const targetIsUsable = returnTarget?.isConnected &&
        !returnTarget.closest("[inert]") &&
        returnTarget.getClientRects().length > 0;
      if (targetIsUsable) returnTarget.focus({ preventScroll: true });
      else {
        const preferredFallback = agentDialogFallbackFocusRef.current;
        const fallback = (preferredFallback
          ? document.querySelector<HTMLButtonElement>(`[data-testid="${preferredFallback}"]`)
          : null) ??
          document.querySelector<HTMLButtonElement>('[data-testid="relay-session-reopen"]') ??
          document.querySelector<HTMLButtonElement>('[data-testid="artifact-library-toggle"]');
        fallback?.focus({ preventScroll: true });
      }
      agentDialogReturnFocusRef.current = null;
      agentDialogFallbackFocusRef.current = null;
    });
  }

  const previewViews = useMemo(
    () => views.map((view) => view.id === initialWorkspace.templateId
      ? { ...view, previewNodes: createWorkspacePreview(nodes) }
      : view),
    [initialWorkspace.templateId, nodes, views],
  );
  const displayViewport = useMemo(
    () => presentationMode && stageSize.width > 0 && stageSize.height > 0
      ? fitNodesToViewport(nodes, stageSize)
      : viewport,
    [nodes, presentationMode, stageSize, viewport],
  );

  async function deleteView(viewId: string) {
    const removingActiveView = viewId === initialWorkspace.templateId;
    try {
      if (removingActiveView) {
        await flushPendingSave();
        suppressRecovery();
      }
      await onDeleteView(viewId, removingActiveView ? workspaceSnapshotRef.current : undefined);
    } catch (error) {
      if (removingActiveView) resumeRecovery();
      setStatus(error instanceof Error ? `Delete failed: ${error.message}` : "Canvas deletion failed");
    }
  }

  async function duplicateView(viewId: string) {
    try {
      if (viewId === initialWorkspace.templateId) await flushPendingSave();
      await onDuplicateView(
        viewId,
        viewId === initialWorkspace.templateId ? workspaceSnapshotRef.current : undefined,
      );
    } catch (error) {
      setStatus(error instanceof Error ? `Duplicate failed: ${error.message}` : "Canvas duplication failed");
    }
  }

  return (
    <main
      className={`app-shell canvas-app-shell ${sidebarOpen ? "sidebar-open" : ""} ${artifactLibraryOpen ? "artifact-library-open" : ""} ${presentationMode ? "presentation-mode" : ""}`}
      data-theme={themeMode}
      data-presentation={presentationMode}
      aria-busy={uiMutationBusy}
    >
      <div className="canvas-sidebar-slot" aria-hidden={!sidebarOpen || agentDialogOpen} inert={!sidebarOpen || uiMutationBusy || agentDialogOpen}>
        <CanvasSidebar
          activeViewId={initialWorkspace.templateId}
          open={sidebarOpen}
          views={previewViews}
          onCreateView={() => {
            onCreateView();
            if (compactOverlay) void onToggleSidebar();
          }}
          onClose={toggleViews}
          onDeleteView={(id) => {
            if (compactOverlay) void onToggleSidebar();
            void deleteView(id);
          }}
          onDuplicateView={(id) => {
            if (compactOverlay) void onToggleSidebar();
            void duplicateView(id);
          }}
          onReorderView={onReorderView}
          onSelectView={(id) => {
            if (compactOverlay) void onToggleSidebar();
            onSelectView(id);
          }}
        />
      </div>
      <section className="workspace" inert={agentDialogOpen || uiMutationBusy || (compactOverlay && (sidebarOpen || artifactLibraryOpen))}>
        <CanvasToolbar
          importInputRef={importInputRef}
          status={status}
          storageMode={storageMode}
          viewTitle={viewTitle}
          sidebarOpen={sidebarOpen}
          artifactLibraryOpen={artifactLibraryOpen}
          canRedo={canRedo}
          canUndo={canUndo}
          themeMode={themeMode}
          snapToGrid={snapToGrid}
          onBuildArtifact={openBuildSession}
          onEnterPresentation={onEnterPresentation}
          onExportWorkspace={exportWorkspace}
          onImportData={importData}
          onImportWorkspace={importWorkspace}
          onResetWorkspace={resetWorkspace}
          onRenameView={(title) => {
            setViewTitle(title);
            onViewTitleChange(initialWorkspace.templateId, title);
          }}
          onThemeToggle={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
          onToggleArtifactLibrary={toggleArtifactLibrary}
          onToggleSidebar={toggleViews}
          onToggleSnapToGrid={toggleSnapToGrid}
          onRedo={redoChange}
          onUndo={undoChange}
        />
        <CanvasBoard
          canvasTheme={canvasTheme}
          nodes={nodes}
          runtimeArtifactRegistry={runtimeArtifactRegistry}
          selectedNodeIds={selectedNodeIds}
          stageRef={stageRef}
          viewport={displayViewport}
          artifactDragActive={Boolean(draggingCatalogItemId)}
          hasMultipleViews={views.length > 1}
          presentationMode={presentationMode}
          onChangeZoom={canvasInteractions.changeZoom}
          onDeleteNode={deleteNode}
          onDeleteSelection={deleteSelection}
          onDuplicateSelection={duplicateSelection}
          onExitPresentation={onExitPresentation}
          onLayoutSelection={applySelectionLayout}
          onNextPresentationView={onNextPresentationView}
          onNodePointerDown={canvasInteractions.handleNodePointerDown}
          onResetView={resetView}
          onPreviousPresentationView={onPreviousPresentationView}
          onArtifactDrop={(catalogItemId, clientX, clientY) => {
            const item = findCatalogItem(catalogItemId);
            if (item) addCatalogItem(item, { x: clientX, y: clientY });
            else setDraggingCatalogItemId("");
          }}
          onResizePointerDown={canvasInteractions.handleResizePointerDown}
          onStagePointerDown={canvasInteractions.handleStagePointerDown}
          selectionRect={canvasInteractions.selectionRect}
        />
      </section>
      <div className={`artifact-library-slot ${artifactLibraryOpen ? "open" : ""}`} aria-hidden={!artifactLibraryOpen || agentDialogOpen} inert={!artifactLibraryOpen || uiMutationBusy || agentDialogOpen}>
        <ArtifactLibrary
          builtIn={artifactCatalog.builtIn}
          canvasTheme={canvasTheme}
          open={artifactLibraryOpen}
          personal={artifactCatalog.personal}
          registry={runtimeArtifactRegistry}
          onAdd={addCatalogItem}
          onBuildArtifact={openBuildSession}
          onClose={() => closeArtifactLibrary(true)}
          onDragEnd={() => setDraggingCatalogItemId("")}
          onDragStart={(item) => setDraggingCatalogItemId(item.id)}
        />
      </div>
      <AgentHandoffDialog
        installBusy={uiMutationBusy}
        open={agentDialogOpen}
        themeMode={themeMode}
        viewId={initialWorkspace.templateId}
        viewIncarnationId={initialWorkspace.incarnationId}
        viewTitle={viewTitle}
        relay={relay}
        onClose={closeAgentDialog}
        onOpen={openAgentDialog}
        onOpenView={onSelectView}
        onInstallBundle={installBundleFile}
      />
    </main>
  );
}
