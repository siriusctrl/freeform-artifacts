import { useEffect, useMemo, useRef, useState } from "react";
import {
  installArtifactBundle,
  loadInstalledArtifactRegistry,
  parseArtifactBundle,
  type ArtifactBundle,
} from "./artifacts/generated/bundles";
import { loadExternalArtifactRegistry } from "./artifacts/generated/externalLoader";
import { artifactRegistry } from "./artifacts/registry";
import type { RegisteredArtifact } from "./artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "./artifacts/types";
import { validateArtifactPayload } from "./artifacts/validation";
import { createBoardState } from "./canvas/board";
import { AgentHandoffDialog } from "./canvas/components/AgentHandoffDialog";
import { CanvasBoard } from "./canvas/components/CanvasBoard";
import { CanvasSidebar } from "./canvas/components/CanvasSidebar";
import { CanvasToolbar } from "./canvas/components/CanvasToolbar";
import { themeFor, type ThemeMode } from "./canvas/constants";
import { publishCanvasDebugState } from "./canvas/debugState";
import { useCanvasInteractions } from "./canvas/hooks/useCanvasInteractions";
import { clampNodesToArtifactMinimums } from "./canvas/nodeSize";
import { importedRevenueRows } from "./data/transformFixtures";
import { revenueSummaryTransform, revenueTableTransform, runTransform } from "./data/transforms";
import { CANVAS_GRID_SIZE, screenToWorld } from "./lib/geometry";
import { downloadWorkspace, parseWorkspace } from "./workspaces/bundle";
import {
  createWorkspace,
  listWorkspaces,
  loadOrCreateWorkspace,
  loadWorkspaceById,
  saveWorkspace,
  setActiveWorkspaceId,
} from "./workspaces/storage";
import { createWorkspaceFromTemplate, getRequestedTemplate } from "./workspaces/templates";
import { createWorkspacePreview } from "./workspaces/preview";
import type { WorkspaceLoadResult, WorkspaceRecord, WorkspaceSummary, WorkspaceTemplate } from "./workspaces/types";

interface BootstrappedWorkspace {
  template: WorkspaceTemplate;
  result: WorkspaceLoadResult;
}

function statusForLoad(result: WorkspaceLoadResult) {
  if (result.source === "existing") {
    return "Local workspace restored";
  }
  if (result.source === "legacy") {
    return "Previous board migrated";
  }
  return "Demo copied to this browser";
}

export default function App() {
  const [bootstrapped, setBootstrapped] = useState<BootstrappedWorkspace | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [views, setViews] = useState<WorkspaceSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const template = useMemo(() => getRequestedTemplate(), []);

  useEffect(() => {
    let cancelled = false;
    loadOrCreateWorkspace(template)
      .then(async (result) => {
        const summaries = await listWorkspaces();
        if (!cancelled) {
          setBootstrapped({ template, result });
          setViews(summaries);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : "Unable to open the local workspace");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [template]);

  async function selectView(id: string) {
    const result = await loadWorkspaceById(id);
    if (!result) return;
    setActiveWorkspaceId(id);
    setBootstrapped({ template, result });
  }

  async function addView() {
    const result = await createWorkspace(template);
    setViews(await listWorkspaces());
    setBootstrapped({ template, result });
  }

  function updateViewTitle(id: string, title: string) {
    setViews((current) => current.map((view) => view.id === id ? { ...view, title } : view));
  }

  async function toggleSidebar() {
    const opening = !sidebarOpen;
    setSidebarOpen(opening);
    if (opening) setViews(await listWorkspaces());
  }

  if (bootstrapError) {
    return (
      <main className="app-shell" data-theme="light">
        <section className="workspace-gate" role="alert">
          <strong>Workspace unavailable</strong>
          <p>{bootstrapError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!bootstrapped) {
    return (
      <main className="app-shell" data-theme="light">
        <section className="workspace-gate" aria-live="polite">
          <strong>Opening your local workspace</strong>
          <p>The public demo stays untouched while this browser loads its own copy.</p>
        </section>
      </main>
    );
  }

  return (
    <CanvasWorkspace
      key={bootstrapped.result.workspace.templateId}
      initialWorkspace={bootstrapped.result.workspace}
      initialStorage={bootstrapped.result.storage}
      initialStatus={statusForLoad(bootstrapped.result)}
      template={bootstrapped.template}
      views={views}
      sidebarOpen={sidebarOpen}
      onCreateView={addView}
      onSelectView={selectView}
      onToggleSidebar={toggleSidebar}
      onViewTitleChange={updateViewTitle}
    />
  );
}

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

function CanvasWorkspace({
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
  const skipInitialSave = useRef(normalizedInitialNodes === initialWorkspace.board.nodes);
  const saveSequence = useRef(0);
  const [nodes, setNodes] = useState<CanvasNode[]>(normalizedInitialNodes);
  const [viewport, setViewport] = useState<CanvasViewport>(initialWorkspace.board.viewport);
  const [selectedNodeId, setSelectedNodeId] = useState(initialWorkspace.board.selectedNodeId);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialWorkspace.board.themeMode);
  const [snapToGrid, setSnapToGrid] = useState(initialWorkspace.board.snapToGrid);
  const [viewTitle, setViewTitle] = useState(initialWorkspace.title);
  const [status, setStatus] = useState(initialStatus);
  const [storageMode, setStorageMode] = useState<WorkspaceLoadResult["storage"]>(initialStorage);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [runtimeArtifactRegistry, setRuntimeArtifactRegistry] =
    useState<Record<string, RegisteredArtifact>>(artifactRegistry);

  const canvasTheme = useMemo(() => themeFor(themeMode), [themeMode]);
  const canvasInteractions = useCanvasInteractions({
    artifactRegistry: runtimeArtifactRegistry,
    setNodes,
    setSelectedNodeId,
    setViewport,
    snapToGrid,
    stageRef,
    viewport,
  });

  function currentWorkspace(): WorkspaceRecord {
    return {
      version: 1,
      templateId: initialWorkspace.templateId,
      title: viewTitle,
      templateVersion: template.version,
      updatedAt: new Date().toISOString(),
      board: createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid }),
    };
  }

  function applyWorkspace(workspace: WorkspaceRecord) {
    setNodes(clampNodesToArtifactMinimums(workspace.board.nodes, runtimeArtifactRegistry));
    setViewport(workspace.board.viewport);
    setSelectedNodeId(workspace.board.selectedNodeId);
    setThemeMode(workspace.board.themeMode);
    setSnapToGrid(workspace.board.snapToGrid);
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadExternalArtifactRegistry(), loadInstalledArtifactRegistry()])
      .then(([externalRegistry, installedRegistry]) => {
        if (cancelled) return;
        setRuntimeArtifactRegistry((current) => ({ ...current, ...externalRegistry, ...installedRegistry }));
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "External artifact load failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setNodes((current) => clampNodesToArtifactMinimums(current, runtimeArtifactRegistry));
  }, [runtimeArtifactRegistry]);

  useEffect(() => {
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }

    const sequence = ++saveSequence.current;
    setStatus("Saving locally");
    saveWorkspace(currentWorkspace())
      .then((mode) => {
        if (sequence === saveSequence.current) {
          setStorageMode(mode);
          setStatus(mode === "indexeddb" ? "Saved locally" : "Saved in browser fallback");
        }
      })
      .catch((error) => {
        if (sequence === saveSequence.current) {
          setStatus(error instanceof Error ? error.message : "Local save failed");
        }
      });
  }, [nodes, viewport, selectedNodeId, themeMode, snapToGrid, viewTitle]);

  useEffect(() => {
    publishCanvasDebugState({
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
  }, [nodes, viewport, selectedNodeId, themeMode, snapToGrid, status, storageMode, runtimeArtifactRegistry, initialWorkspace.templateId]);

  function deleteNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? "" : current));
  }

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      if (!selectedNodeId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      deleteNode(selectedNodeId);
    }
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [selectedNodeId]);

  function importData() {
    const summary = runTransform(revenueSummaryTransform, importedRevenueRows);
    const table = runTransform(revenueTableTransform, importedRevenueRows);
    if (!summary.ok || !table.ok) {
      setStatus(`Import failed: ${summary.ok ? table.message : summary.message}`);
      return;
    }

    setNodes((current) =>
      current.map((node) => {
        if (node.id === "node-revenue") {
          return {
            ...node,
            data: summary.data,
            dataBinding: { sourceId: "imported-revenue", transformId: revenueSummaryTransform.id },
          };
        }
        if (node.id === "node-table") {
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
    downloadWorkspace(currentWorkspace());
    setStatus("Workspace backup downloaded");
  }

  async function importWorkspace(file: File) {
    try {
      const imported = parseWorkspace(await file.text());
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

  function createBundleNode(
    bundle: ArtifactBundle,
    artifact: RegisteredArtifact,
    targetNodes: CanvasNode[],
    targetViewport = viewport,
  ): CanvasNode {
    const stageRect = stageRef.current?.getBoundingClientRect();
    const center = stageRect
      ? screenToWorld({ x: stageRect.left + stageRect.width / 2, y: stageRect.top + stageRect.height / 2 }, targetViewport)
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

  async function installBundle(value: unknown, options: { viewId?: string } = {}) {
    const { artifact, bundle } = await installArtifactBundle(value);
    const targetViewId = options.viewId ?? initialWorkspace.templateId;
    setRuntimeArtifactRegistry((current) => ({ ...current, [artifact.id]: artifact }));

    if (targetViewId === initialWorkspace.templateId) {
      const node = createBundleNode(bundle, artifact, nodes);
      const validation = validateArtifactPayload(node, artifact);
      if (!validation.ok) throw new Error(validation.message);
      const nextNodes = [...nodes, node];
      const workspace = {
        ...currentWorkspace(),
        board: createBoardState({ nodes: nextNodes, viewport, selectedNodeId: node.id, themeMode, snapToGrid }),
      };
      const mode = await saveWorkspace(workspace);
      setNodes(nextNodes);
      setSelectedNodeId(node.id);
      setStorageMode(mode);
      setStatus(`Installed ${artifact.title}`);
      return { artifactId: artifact.id, nodeId: node.id, viewId: targetViewId };
    }

    const target = await loadWorkspaceById(targetViewId);
    if (!target) throw new Error(`Unknown canvas view: ${targetViewId}`);
    const node = createBundleNode(bundle, artifact, target.workspace.board.nodes, target.workspace.board.viewport);
    const validation = validateArtifactPayload(node, artifact);
    if (!validation.ok) throw new Error(validation.message);
    await saveWorkspace({
      ...target.workspace,
      updatedAt: new Date().toISOString(),
      board: { ...target.workspace.board, nodes: [...target.workspace.board.nodes, node], selectedNodeId: node.id },
    });
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
      listViews: listWorkspaces,
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
          themeMode={themeMode}
          snapToGrid={snapToGrid}
          onBuildArtifact={() => setAgentDialogOpen(true)}
          onExportWorkspace={exportWorkspace}
          onImportData={importData}
          onImportWorkspace={importWorkspace}
          onResetWorkspace={resetWorkspace}
          onRenameView={(title) => {
            setViewTitle(title);
            onViewTitleChange(initialWorkspace.templateId, title);
          }}
          onThemeToggle={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
          onToggleSidebar={onToggleSidebar}
          onToggleSnapToGrid={toggleSnapToGrid}
        />
        <CanvasBoard
          canvasTheme={canvasTheme}
          nodes={nodes}
          runtimeArtifactRegistry={runtimeArtifactRegistry}
          selectedNodeId={selectedNodeId}
          stageRef={stageRef}
          viewport={viewport}
          onChangeZoom={canvasInteractions.changeZoom}
          onDeleteNode={deleteNode}
          onNodePointerDown={canvasInteractions.handleNodePointerDown}
          onResetView={resetView}
          onResizePointerDown={canvasInteractions.handleResizePointerDown}
          onStagePointerDown={canvasInteractions.handleStagePointerDown}
        />
      </section>
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
      listViews: typeof listWorkspaces;
      installArtifact: (bundle: unknown, options?: { viewId?: string }) => Promise<{
        artifactId: string;
        nodeId: string;
        viewId: string;
      }>;
    };
  }
}
