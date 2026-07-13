import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseArtifactBundle,
  prepareArtifactBundle,
} from "../artifacts/generated/bundles";
import { artifactRegistry } from "../artifacts/registry";
import { createArtifactCatalog, type ArtifactCatalogItem } from "./artifactCatalog";
import { assertSupportedRawEChartsOption, buildChartKitOption, CHART_KIT_CAPABILITIES } from "../artifacts/chartKit";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import { useArtifactRuntime } from "../artifacts/useArtifactRuntime";
import { validateArtifactPayload } from "../artifacts/validation";
import { importedRevenueRows } from "../data/transformFixtures";
import { revenueSummaryTransform, revenueTableTransform, runTransform } from "../data/transforms";
import { CANVAS_GRID_SIZE, clientToStage, screenToWorld, snapToGrid as snapWorldToGrid } from "../lib/geometry";
import { downloadWorkspace, parseWorkspace } from "../workspaces/bundle";
import {
  commitWorkspaceWithArtifactPackage,
  listWorkspaces,
  loadWorkspaceById,
  saveWorkspace,
} from "../workspaces/storage";
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
import { useCanvasInteractions } from "./hooks/useCanvasInteractions";
import { useCanvasShortcuts } from "./hooks/useCanvasShortcuts";
import { createArtifactNode, createBundleNode, moveNodeToNearestOpenPosition } from "./nodeFactory";
import { clampNodesToArtifactMinimums } from "./nodeSize";

interface CanvasWorkspaceProps {
  initialWorkspace: WorkspaceRecord;
  initialStorage: WorkspaceLoadResult["storage"];
  initialStatus: string;
  template: WorkspaceTemplate;
  views: WorkspaceSummary[];
  sidebarOpen: boolean;
  onCreateView: () => void;
  onSelectView: (id: string) => void;
  onToggleSidebar: () => void;
  onViewTitleChange: (id: string, title: string) => void;
}

export function CanvasWorkspace({
  initialWorkspace,
  initialStorage,
  initialStatus,
  template,
  views,
  sidebarOpen,
  onCreateView,
  onSelectView,
  onToggleSidebar,
  onViewTitleChange,
}: CanvasWorkspaceProps) {
  const normalizedInitialNodes = useMemo(
    () => clampNodesToArtifactMinimums(initialWorkspace.board.nodes, artifactRegistry),
    [initialWorkspace.board.nodes],
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const skipInitialSave = normalizedInitialNodes === initialWorkspace.board.nodes;
  const [nodes, setNodes] = useState<CanvasNode[]>(normalizedInitialNodes);
  const [viewport, setViewport] = useState<CanvasViewport>(initialWorkspace.board.viewport);
  const [selectedNodeId, setSelectedNodeId] = useState(initialWorkspace.board.selectedNodeId);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialWorkspace.board.themeMode);
  const [snapToGrid, setSnapToGrid] = useState(initialWorkspace.board.snapToGrid);
  const [viewTitle, setViewTitle] = useState(initialWorkspace.title);
  const [status, setStatus] = useState(initialStatus);
  const [storageMode, setStorageMode] = useState<WorkspaceLoadResult["storage"]>(initialStorage);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [artifactLibraryOpen, setArtifactLibraryOpen] = useState(false);
  const [draggingCatalogItemId, setDraggingCatalogItemId] = useState("");
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
  const canvasInteractions = useCanvasInteractions({
    artifactRegistry: runtimeArtifactRegistry,
    setNodes,
    setSelectedNodeId,
    setViewport,
    snapToGrid,
    stageRef,
    viewport,
  });

  const workspaceSnapshot = useMemo<WorkspaceRecord>(
    () => ({
      version: 1,
      templateId: initialWorkspace.templateId,
      title: viewTitle,
      templateVersion: template.version,
      updatedAt: new Date().toISOString(),
      board: createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid }),
    }),
    [initialWorkspace.templateId, nodes, selectedNodeId, snapToGrid, template.version, themeMode, viewTitle, viewport],
  );

  function applyWorkspace(workspace: WorkspaceRecord) {
    setNodes(clampNodesToArtifactMinimums(workspace.board.nodes, runtimeArtifactRegistry));
    setViewport(workspace.board.viewport);
    setSelectedNodeId(workspace.board.selectedNodeId);
    setThemeMode(workspace.board.themeMode);
    setSnapToGrid(workspace.board.snapToGrid);
  }

  useEffect(() => {
    if (artifactIssueStatus) setStatus(artifactIssueStatus);
  }, [artifactIssueStatus]);

  useEffect(() => {
    setNodes((current) => clampNodesToArtifactMinimums(current, runtimeArtifactRegistry));
  }, [runtimeArtifactRegistry]);

  const { cancelPendingSave } = useWorkspaceAutosave({
    workspace: workspaceSnapshot,
    skipInitialSave,
    onSaving: () => setStatus("Saving locally"),
    onSaved: (mode) => {
      setStorageMode(mode);
      setStatus(artifactIssueStatus ?? (mode === "indexeddb" ? "Saved locally" : "Saved in browser fallback"));
    },
    onError: setStatus,
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
      snapToGrid,
      status,
      storageMode,
      templateId: initialWorkspace.templateId,
      themeMode,
      viewport,
    });
  }, [artifactCatalog, artifactLibraryOpen, nodes, viewport, selectedNodeId, themeMode, snapToGrid, status, storageMode, runtimeArtifactRegistry, initialWorkspace.templateId]);

  function deleteNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? "" : current));
  }

  function importData() {
    const summary = runTransform(revenueSummaryTransform, importedRevenueRows);
    const table = runTransform(revenueTableTransform, importedRevenueRows);
    if (!summary.ok || !table.ok) {
      setStatus(`Import failed: ${summary.ok ? table.message : summary.message}`);
      return;
    }

    setNodes((current) =>
      current.map((node) => {
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
    );
    setSelectedNodeId("node-revenue");
  }

  function exportWorkspace() {
    downloadWorkspace(workspaceSnapshot);
    setStatus("Board-data backup downloaded");
  }

  async function importWorkspace(file: File) {
    cancelPendingSave();
    try {
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
      applyWorkspace(workspace);
      const mode = await saveWorkspace(workspace);
      setStorageMode(mode);
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
    applyWorkspace(createWorkspaceFromTemplate(template, { id: initialWorkspace.templateId, title: viewTitle }));
    setStatus("Demo restored in this browser");
  }

  function resetView() {
    canvasInteractions.resetView();
  }

  function toggleSnapToGrid() {
    setSnapToGrid((current) => !current);
  }

  function toggleViews() {
    setArtifactLibraryOpen(false);
    setDraggingCatalogItemId("");
    void onToggleSidebar();
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

  function validatePreparedArtifact(node: CanvasNode, artifact: RegisteredArtifact) {
    const validation = validateArtifactPayload(node, artifact);
    if (!validation.ok) throw new Error(validation.message);
    const sizes = [artifact.defaultSize, artifact.minSize ?? artifact.defaultSize];
    let renderChecks = 0;
    for (const mode of ["light", "dark"] as const) {
      for (const size of sizes) {
        const props = { data: node.data, config: node.config, size, theme: themeFor(mode) };
        if (artifact.renderer === "chart-kit") {
          buildChartKitOption(artifact.buildChart(props), props);
          renderChecks += 1;
        } else if (artifact.renderer === "echarts") {
          assertSupportedRawEChartsOption(artifact.buildOption(props));
          renderChecks += 1;
        }
      }
    }
    return renderChecks;
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
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    closeArtifactLibrary();
    setStatus(`Added ${item.title}`);
    window.requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
  }

  function findCatalogItem(id: string) {
    return [...artifactCatalog.builtIn, ...artifactCatalog.personal].find((item) => item.id === id);
  }

  useCanvasShortcuts({
    disabled: agentDialogOpen,
    selectedNodeId,
    onDeleteNode: deleteNode,
    onDismiss: () => {
      if (artifactLibraryOpen) closeArtifactLibrary(true);
      else if (sidebarOpen) void onToggleSidebar();
      else setSelectedNodeId("");
    },
    onResetView: resetView,
    onToggleArtifacts: toggleArtifactLibrary,
    onToggleViews: toggleViews,
    onZoomIn: () => canvasInteractions.changeZoom(1.15),
    onZoomOut: () => canvasInteractions.changeZoom(0.85),
  });

  async function validateBundle(value: unknown) {
    const { artifact, bundle } = await prepareArtifactBundle(value, runtimeArtifactRegistry);
    const stageRect = stageRef.current?.getBoundingClientRect();
    const stageSize = stageRect ? { width: stageRect.width, height: stageRect.height } : undefined;
    const node = createBundleNode(bundle, artifact, nodes, viewport, stageSize);
    const renderChecks = validatePreparedArtifact(node, artifact);
    return {
      artifactId: artifact.id,
      renderer: artifact.renderer ?? "react",
      renderChecks,
      persisted: false as const,
    };
  }

  async function installBundle(value: unknown, options: { viewId?: string } = {}) {
    const { artifact, bundle } = await prepareArtifactBundle(value, runtimeArtifactRegistry);
    const targetViewId = options.viewId ?? initialWorkspace.templateId;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const stageSize = stageRect ? { width: stageRect.width, height: stageRect.height } : undefined;

    if (targetViewId === initialWorkspace.templateId) {
      const node = createBundleNode(bundle, artifact, nodes, viewport, stageSize);
      validatePreparedArtifact(node, artifact);
      const nextNodes = [...nodes, node];
      const workspace = {
        ...workspaceSnapshot,
        board: createBoardState({ nodes: nextNodes, viewport, selectedNodeId: node.id, themeMode, snapToGrid }),
      };
      cancelPendingSave();
      const mode = await commitWorkspaceWithArtifactPackage(workspace, bundle);
      setRuntimeArtifactRegistry((current) => ({ ...current, [artifact.id]: artifact }));
      setPersonalBundles((current) => [...current.filter((entry) => entry.artifactId !== bundle.artifactId), bundle]);
      setNodes(nextNodes);
      setSelectedNodeId(node.id);
      setStorageMode(mode);
      setStatus(`Installed ${artifact.title}`);
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
      board: { ...target.workspace.board, nodes: [...target.workspace.board.nodes, node], selectedNodeId: node.id },
    };
    await commitWorkspaceWithArtifactPackage(workspace, bundle);
    setRuntimeArtifactRegistry((current) => ({ ...current, [artifact.id]: artifact }));
    setPersonalBundles((current) => [...current.filter((entry) => entry.artifactId !== bundle.artifactId), bundle]);
    return { artifactId: artifact.id, nodeId: node.id, viewId: targetViewId };
  }

  async function installBundleFile(file: File) {
    try {
      await installBundle(parseArtifactBundle(await file.text()));
      setAgentDialogOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `Install failed: ${error.message}` : "Artifact install failed");
    }
  }

  useEffect(() => {
    window.__FREEFORM_AGENT__ = {
      activeViewId: initialWorkspace.templateId,
      capabilities: {
        chartKit: CHART_KIT_CAPABILITIES,
      },
      listViews: listWorkspaces,
      validateArtifact: validateBundle,
      installArtifact: installBundle,
    };
    return () => {
      delete window.__FREEFORM_AGENT__;
    };
  });

  const previewViews = useMemo(
    () => views.map((view) => view.id === initialWorkspace.templateId
      ? { ...view, previewNodes: createWorkspacePreview(nodes) }
      : view),
    [initialWorkspace.templateId, nodes, views],
  );

  return (
    <main className={`app-shell canvas-app-shell ${sidebarOpen ? "sidebar-open" : ""}`} data-theme={themeMode}>
      <div className="canvas-sidebar-slot" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <CanvasSidebar
          activeViewId={initialWorkspace.templateId}
          views={previewViews}
          onCreateView={onCreateView}
          onSelectView={onSelectView}
        />
      </div>
      <section className="workspace">
        <CanvasToolbar
          importInputRef={importInputRef}
          status={status}
          storageMode={storageMode}
          viewTitle={viewTitle}
          sidebarOpen={sidebarOpen}
          artifactLibraryOpen={artifactLibraryOpen}
          themeMode={themeMode}
          snapToGrid={snapToGrid}
          onBuildArtifact={() => { setArtifactLibraryOpen(false); setAgentDialogOpen(true); }}
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
        />
        <CanvasBoard
          canvasTheme={canvasTheme}
          nodes={nodes}
          runtimeArtifactRegistry={runtimeArtifactRegistry}
          selectedNodeId={selectedNodeId}
          stageRef={stageRef}
          viewport={viewport}
          artifactDragActive={Boolean(draggingCatalogItemId)}
          onChangeZoom={canvasInteractions.changeZoom}
          onDeleteNode={deleteNode}
          onNodePointerDown={canvasInteractions.handleNodePointerDown}
          onResetView={resetView}
          onArtifactDrop={(catalogItemId, clientX, clientY) => {
            const item = findCatalogItem(catalogItemId);
            if (item) addCatalogItem(item, { x: clientX, y: clientY });
            else setDraggingCatalogItemId("");
          }}
          onResizePointerDown={canvasInteractions.handleResizePointerDown}
          onStagePointerDown={canvasInteractions.handleStagePointerDown}
        />
      </section>
      <div className={`artifact-library-slot ${artifactLibraryOpen ? "open" : ""}`} aria-hidden={!artifactLibraryOpen} inert={!artifactLibraryOpen}>
        <ArtifactLibrary
          builtIn={artifactCatalog.builtIn}
          canvasTheme={canvasTheme}
          open={artifactLibraryOpen}
          personal={artifactCatalog.personal}
          registry={runtimeArtifactRegistry}
          onAdd={addCatalogItem}
          onBuildArtifact={() => { setArtifactLibraryOpen(false); setAgentDialogOpen(true); }}
          onClose={() => closeArtifactLibrary(true)}
          onDragEnd={() => setDraggingCatalogItemId("")}
          onDragStart={(item) => setDraggingCatalogItemId(item.id)}
        />
      </div>
      <AgentHandoffDialog
        open={agentDialogOpen}
        viewId={initialWorkspace.templateId}
        onClose={() => setAgentDialogOpen(false)}
        onInstallBundle={installBundleFile}
      />
    </main>
  );
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
      installArtifact: (bundle: unknown, options?: { viewId?: string }) => Promise<{
        artifactId: string;
        nodeId: string;
        viewId: string;
      }>;
    };
  }
}
