import { useEffect, useMemo, useRef, useState } from "react";
import { loadExternalArtifactRegistry } from "./artifacts/generated/externalLoader";
import { artifactRegistry } from "./artifacts/registry";
import type { RegisteredArtifact } from "./artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "./artifacts/types";
import { createBoardState } from "./canvas/board";
import { CanvasBoard } from "./canvas/components/CanvasBoard";
import { CanvasToolbar } from "./canvas/components/CanvasToolbar";
import { themeFor, type ThemeMode } from "./canvas/constants";
import { publishCanvasDebugState } from "./canvas/debugState";
import { useCanvasInteractions } from "./canvas/hooks/useCanvasInteractions";
import { createMetricNode } from "./canvas/nodeFactory";
import { importedRevenueRows } from "./data/transformFixtures";
import { revenueSummaryTransform, revenueTableTransform, runTransform } from "./data/transforms";
import { CANVAS_GRID_SIZE, screenToWorld } from "./lib/geometry";
import { downloadWorkspace, parseWorkspace } from "./workspaces/bundle";
import { loadOrCreateWorkspace, saveWorkspace } from "./workspaces/storage";
import { createWorkspaceFromTemplate, getRequestedTemplate } from "./workspaces/templates";
import type { WorkspaceLoadResult, WorkspaceRecord, WorkspaceTemplate } from "./workspaces/types";

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

  useEffect(() => {
    let cancelled = false;
    const template = getRequestedTemplate();

    loadOrCreateWorkspace(template)
      .then((result) => {
        if (!cancelled) {
          setBootstrapped({ template, result });
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
  }, []);

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
      initialWorkspace={bootstrapped.result.workspace}
      initialStorage={bootstrapped.result.storage}
      initialStatus={statusForLoad(bootstrapped.result)}
      template={bootstrapped.template}
    />
  );
}

interface CanvasWorkspaceProps {
  initialWorkspace: WorkspaceRecord;
  initialStorage: WorkspaceLoadResult["storage"];
  initialStatus: string;
  template: WorkspaceTemplate;
}

function CanvasWorkspace({ initialWorkspace, initialStorage, initialStatus, template }: CanvasWorkspaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const skipInitialSave = useRef(true);
  const saveSequence = useRef(0);
  const [nodes, setNodes] = useState<CanvasNode[]>(initialWorkspace.board.nodes);
  const [viewport, setViewport] = useState<CanvasViewport>(initialWorkspace.board.viewport);
  const [selectedNodeId, setSelectedNodeId] = useState(initialWorkspace.board.selectedNodeId);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialWorkspace.board.themeMode);
  const [snapToGrid, setSnapToGrid] = useState(initialWorkspace.board.snapToGrid);
  const [status, setStatus] = useState(initialStatus);
  const [storageMode, setStorageMode] = useState<WorkspaceLoadResult["storage"]>(initialStorage);
  const [runtimeArtifactRegistry, setRuntimeArtifactRegistry] =
    useState<Record<string, RegisteredArtifact>>(artifactRegistry);

  const canvasTheme = useMemo(() => themeFor(themeMode), [themeMode]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const canvasInteractions = useCanvasInteractions({
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
      templateId: template.id,
      templateVersion: template.version,
      updatedAt: new Date().toISOString(),
      board: createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid }),
    };
  }

  function applyWorkspace(workspace: WorkspaceRecord) {
    setNodes(workspace.board.nodes);
    setViewport(workspace.board.viewport);
    setSelectedNodeId(workspace.board.selectedNodeId);
    setThemeMode(workspace.board.themeMode);
    setSnapToGrid(workspace.board.snapToGrid);
  }

  useEffect(() => {
    let cancelled = false;

    loadExternalArtifactRegistry()
      .then((externalRegistry) => {
        if (cancelled || Object.keys(externalRegistry).length === 0) {
          return;
        }
        setRuntimeArtifactRegistry((current) => ({ ...current, ...externalRegistry }));
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
  }, [nodes, viewport, selectedNodeId, themeMode, snapToGrid]);

  useEffect(() => {
    publishCanvasDebugState({
      artifactRegistry: runtimeArtifactRegistry,
      nodes,
      selectedNodeId,
      snapToGrid,
      status,
      storageMode,
      templateId: template.id,
      themeMode,
      viewport,
    });
  }, [nodes, viewport, selectedNodeId, themeMode, snapToGrid, status, storageMode, runtimeArtifactRegistry, template.id]);

  function addArtifact() {
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width * 0.58 - 140, y: rect.top + rect.height * 0.62 - 85 }
      : { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 85 };
    const world = screenToWorld(center, viewport);
    const next = createMetricNode(nodes.length, world);
    setNodes((current) => [...current, next]);
    setSelectedNodeId(next.id);
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
      const workspace = {
        ...imported,
        templateId: template.id,
        templateVersion: template.version,
        updatedAt: new Date().toISOString(),
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
    applyWorkspace(createWorkspaceFromTemplate(template));
    setStatus("Demo restored in this browser");
  }

  function resetView() {
    canvasInteractions.resetView();
  }

  function toggleSnapToGrid() {
    setSnapToGrid((current) => !current);
  }

  return (
    <main className="app-shell" data-theme={themeMode}>
      <section className="workspace">
        <CanvasToolbar
          importInputRef={importInputRef}
          status={status}
          storageMode={storageMode}
          templateTitle={template.title}
          themeMode={themeMode}
          snapToGrid={snapToGrid}
          onAddArtifact={addArtifact}
          onExportWorkspace={exportWorkspace}
          onImportData={importData}
          onImportWorkspace={importWorkspace}
          onResetWorkspace={resetWorkspace}
          onThemeToggle={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
          onToggleSnapToGrid={toggleSnapToGrid}
        />
        <CanvasBoard
          canvasTheme={canvasTheme}
          nodes={nodes}
          runtimeArtifactRegistry={runtimeArtifactRegistry}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          snapToGrid={snapToGrid}
          stageRef={stageRef}
          viewport={viewport}
          onChangeZoom={canvasInteractions.changeZoom}
          onNodePointerDown={canvasInteractions.handleNodePointerDown}
          onResetView={resetView}
          onResizePointerDown={canvasInteractions.handleResizePointerDown}
          onStagePointerDown={canvasInteractions.handleStagePointerDown}
        />
      </section>
    </main>
  );
}
