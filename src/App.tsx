import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  Database,
  Frame,
  Grid3X3,
  Minus,
  Moon,
  MousePointer2,
  Plus,
  Sun,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { artifactRegistry, initialNodes } from "./artifacts/registry";
import type { CanvasNode, CanvasTheme, CanvasViewport } from "./artifacts/types";
import { screenToWorld, zoomAt } from "./lib/geometry";

type ThemeMode = "light" | "dark";

type DragState =
  | { type: "pan"; startX: number; startY: number; viewport: CanvasViewport }
  | { type: "node"; nodeId: string; startWorldX: number; startWorldY: number; nodeX: number; nodeY: number };

const INITIAL_VIEWPORT: CanvasViewport = { x: 80, y: 80, scale: 1 };

function themeFor(mode: ThemeMode): CanvasTheme {
  if (mode === "dark") {
    return {
      mode,
      accent: "#35c8dc",
      surface: "#171b1d",
      text: "#eef3f3",
    };
  }

  return {
    mode,
    accent: "#0098b8",
    surface: "#ffffff",
    text: "#171717",
  };
}

function createMetricNode(index: number, position: { x: number; y: number }): CanvasNode {
  return {
    id: `node-ai-${Date.now()}`,
    artifactId: "metric-card",
    title: "AI Generated Metric",
    x: Math.round(position.x + index * 18),
    y: Math.round(position.y + index * 14),
    width: 280,
    height: 170,
    zIndex: 10 + index,
    data: {
      label: "AI generated card",
      value: 224_800 + index * 4_200,
      delta: 0.12,
      caption: "Created from registry contract",
    },
    config: {},
  };
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>(initialNodes);
  const [viewport, setViewport] = useState<CanvasViewport>(INITIAL_VIEWPORT);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("node-revenue");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const canvasTheme = useMemo(() => themeFor(themeMode), [themeMode]);

  useEffect(() => {
    dragRef.current = drag;
    document.body.classList.toggle("dragging-canvas", Boolean(drag));

    return () => {
      if (!dragRef.current) {
        document.body.classList.remove("dragging-canvas");
      }
    };
  }, [drag]);

  useEffect(() => {
    window.__FREEFORM_STATE__ = {
      get nodes() {
        return nodes;
      },
      get viewport() {
        return viewport;
      },
      get selectedNodeId() {
        return selectedNodeId;
      },
      get themeMode() {
        return themeMode;
      },
    };
  }, [nodes, viewport, selectedNodeId, themeMode]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const currentDrag = dragRef.current;
      if (!currentDrag) {
        return;
      }

      event.preventDefault();

      if (currentDrag.type === "pan") {
        setViewport({
          ...currentDrag.viewport,
          x: currentDrag.viewport.x + event.clientX - currentDrag.startX,
          y: currentDrag.viewport.y + event.clientY - currentDrag.startY,
        });
        return;
      }

      const world = screenToWorld({ x: event.clientX, y: event.clientY }, viewport);
      const nextX = currentDrag.nodeX + world.x - currentDrag.startWorldX;
      const nextY = currentDrag.nodeY + world.y - currentDrag.startWorldY;
      updateNodePosition(currentDrag.nodeId, nextX, nextY);
    }

    function handlePointerUp() {
      endDrag();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [viewport]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      setViewport((current) => zoomAt(current, { x: event.clientX, y: event.clientY }, current.scale * delta));
    }

    stage.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      stage.removeEventListener("wheel", handleWheel);
    };
  }, []);

  function updateNodePosition(nodeId: string, x: number, y: number) {
    setNodes((current) =>
      current.map((node) => (node.id === nodeId ? { ...node, x: Math.round(x), y: Math.round(y) } : node)),
    );
  }

  function bringToFront(nodeId: string) {
    setNodes((current) => {
      const maxZ = Math.max(...current.map((node) => node.zIndex));
      return current.map((node) => (node.id === nodeId ? { ...node, zIndex: maxZ + 1 } : node));
    });
  }

  function startDrag(nextDrag: DragState) {
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }

  function endDrag() {
    dragRef.current = null;
    setDrag(null);
  }

  function handleStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || target?.closest(".canvas-node, button, a, input, textarea, select")) {
      return;
    }

    event.preventDefault();
    setSelectedNodeId("");
    startDrag({
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      viewport,
    });
  }

  function handleNodePointerDown(event: React.PointerEvent<HTMLDivElement>, node: CanvasNode) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const world = screenToWorld({ x: event.clientX, y: event.clientY }, viewport);
    setSelectedNodeId(node.id);
    bringToFront(node.id);
    startDrag({
      type: "node",
      nodeId: node.id,
      startWorldX: world.x,
      startWorldY: world.y,
      nodeX: node.x,
      nodeY: node.y,
    });
  }

  function changeZoom(factor: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setViewport((current) => zoomAt(current, center, current.scale * factor));
  }

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

  function resetView() {
    setViewport(INITIAL_VIEWPORT);
  }

  return (
    <main className="app-shell" data-theme={themeMode}>
      <section className="workspace">
        <header className="topbar">
          <div className="title-block">
            <Frame size={22} />
            <span>Freeform Artifacts</span>
          </div>
          <div className="tool-strip" aria-label="Canvas tools">
            <button type="button" className="icon-button active" title="Select">
              <MousePointer2 size={20} />
            </button>
            <button type="button" className="icon-button" title="Grid">
              <Grid3X3 size={20} />
            </button>
            <button type="button" className="icon-button" title="Import data">
              <Database size={20} />
            </button>
            <button type="button" className="icon-button" title="Export proof">
              <ArrowDownToLine size={20} />
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              title={themeMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
              data-testid="theme-toggle"
            >
              {themeMode === "light" ? <Moon size={20} /> : <Sun size={20} />}
              <span>{themeMode === "light" ? "Dark" : "Light"}</span>
            </button>
          </div>
          <button type="button" className="primary-action" onClick={addArtifact} data-testid="add-artifact">
            <Plus size={18} />
            <span>Add artifact</span>
          </button>
        </header>

        <div
          ref={stageRef}
          className="canvas-stage"
          data-testid="canvas-stage"
          data-scale={viewport.scale.toFixed(3)}
          data-selected-node={selectedNodeId}
          onPointerDown={handleStagePointerDown}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="grid-plane" />
          <div
            className="canvas-world"
            data-testid="canvas-world"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            }}
          >
            {nodes.map((node) => {
              const artifact = artifactRegistry[node.artifactId];
              const isSelected = node.id === selectedNodeId;

              return (
                <div
                  key={node.id}
                  className={`canvas-node ${isSelected ? "selected" : ""}`}
                  data-testid={`node-${node.id}`}
                  data-node-id={node.id}
                  draggable={false}
                  style={{
                    width: node.width,
                    height: node.height,
                    transform: `translate(${node.x}px, ${node.y}px)`,
                    zIndex: node.zIndex,
                  }}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <div className="node-chrome">
                    <AppWindow size={14} />
                    <span>{node.title}</span>
                  </div>
                  <div className="node-body">
                    {artifact.render({
                      data: node.data,
                      config: node.config,
                      theme: canvasTheme,
                      emit: () => undefined,
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="zoom-controls" aria-label="Zoom controls">
            <button
              type="button"
              className="icon-button"
              onClick={() => changeZoom(0.85)}
              title="Zoom out"
              data-testid="zoom-out"
            >
              <ZoomOut size={19} />
            </button>
            <span data-testid="zoom-level">{Math.round(viewport.scale * 100)}%</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => changeZoom(1.15)}
              title="Zoom in"
              data-testid="zoom-in"
            >
              <ZoomIn size={19} />
            </button>
            <button type="button" className="icon-button" onClick={resetView} title="Reset view">
              <Minus size={19} />
            </button>
          </div>

          <aside className="inspector" aria-label="Selection inspector">
            <div className="inspector-label">Selection</div>
            {selectedNode ? (
              <>
                <div className="inspector-title">{selectedNode.title}</div>
                <dl>
                  <div>
                    <dt>Artifact</dt>
                    <dd>{selectedNode.artifactId}</dd>
                  </div>
                  <div>
                    <dt>Position</dt>
                    <dd>
                      {selectedNode.x}, {selectedNode.y}
                    </dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>
                      {selectedNode.width} x {selectedNode.height}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p>No artifact selected</p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

declare global {
  interface Window {
    __FREEFORM_STATE__?: {
      readonly nodes: CanvasNode[];
      readonly viewport: CanvasViewport;
      readonly selectedNodeId: string;
      readonly themeMode: ThemeMode;
    };
  }
}
