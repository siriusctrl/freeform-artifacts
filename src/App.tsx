import { useEffect, useMemo, useRef, useState } from "react";
import { loadExternalArtifactRegistry } from "./artifacts/generated/externalLoader";
import { artifactRegistry } from "./artifacts/registry";
import type { RegisteredArtifact } from "./artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "./artifacts/types";
import { createBoardState, downloadBoardState, loadBoardState, saveBoardState } from "./canvas/board";
import { CanvasBoard } from "./canvas/components/CanvasBoard";
import { CanvasToolbar } from "./canvas/components/CanvasToolbar";
import { INITIAL_VIEWPORT, themeFor, type ThemeMode } from "./canvas/constants";
import { publishCanvasDebugState } from "./canvas/debugState";
import { useCanvasInteractions } from "./canvas/hooks/useCanvasInteractions";
import { createMetricNode } from "./canvas/nodeFactory";
import { initialNodes } from "./canvas/seeds/demoBoard";
import { importedRevenueRows } from "./data/transformFixtures";
import { revenueSummaryTransform, revenueTableTransform, runTransform } from "./data/transforms";
import { CANVAS_GRID_SIZE, screenToWorld } from "./lib/geometry";

export default function App() {
  const [savedBoard] = useState(() => loadBoardState());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>(() => savedBoard?.nodes ?? initialNodes);
  const [viewport, setViewport] = useState<CanvasViewport>(() => savedBoard?.viewport ?? INITIAL_VIEWPORT);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => savedBoard?.selectedNodeId ?? "node-revenue");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => savedBoard?.themeMode ?? "light");
  const [snapToGrid, setSnapToGrid] = useState(() => savedBoard?.snapToGrid ?? true);
  const [status, setStatus] = useState(savedBoard ? "Restored saved board" : "Autosave ready");
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

  useEffect(() => {
    let cancelled = false;

    loadExternalArtifactRegistry()
      .then((externalRegistry) => {
        if (cancelled || Object.keys(externalRegistry).length === 0) {
          return;
        }
        setRuntimeArtifactRegistry((current) => ({ ...current, ...externalRegistry }));
        setStatus(`Loaded ${Object.keys(externalRegistry).length} external artifact`);
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
    const board = createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid });
    saveBoardState(board);
    publishCanvasDebugState({
      artifactRegistry: runtimeArtifactRegistry,
      nodes,
      selectedNodeId,
      snapToGrid,
      status,
      themeMode,
      viewport,
    });
  }, [nodes, viewport, selectedNodeId, themeMode, snapToGrid, status, runtimeArtifactRegistry]);

  function addArtifact() {
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width * 0.58 - 140, y: rect.top + rect.height * 0.62 - 85 }
      : { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 85 };
    const world = screenToWorld(center, viewport);
    const next = createMetricNode(nodes.length, world);
    setNodes((current) => [...current, next]);
    setSelectedNodeId(next.id);
    setStatus("Added registry artifact");
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
    setStatus("Imported query result");
  }

  function exportBoard() {
    downloadBoardState(createBoardState({ nodes, viewport, selectedNodeId, themeMode, snapToGrid }));
    setStatus("Exported board JSON");
  }

  function resetView() {
    canvasInteractions.resetView();
    setStatus("Reset view");
  }

  function toggleSnapToGrid() {
    const nextSnapToGrid = !snapToGrid;
    setSnapToGrid(nextSnapToGrid);
    setStatus(nextSnapToGrid ? `Snap to ${CANVAS_GRID_SIZE}px grid` : "Free placement mode");
  }

  return (
    <main className="app-shell" data-theme={themeMode}>
      <section className="workspace">
        <CanvasToolbar
          status={status}
          themeMode={themeMode}
          snapToGrid={snapToGrid}
          onAddArtifact={addArtifact}
          onExportBoard={exportBoard}
          onImportData={importData}
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
