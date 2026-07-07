import { useMemo, useRef, useState } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  Database,
  Frame,
  Grid3X3,
  Minus,
  MousePointer2,
  PanelsTopLeft,
  Plus,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { artifactRegistry, initialNodes } from "./artifacts/registry";
import type { CanvasNode, CanvasViewport } from "./artifacts/types";
import { clampScale, screenToWorld, zoomAt } from "./lib/geometry";

type DragState =
  | { type: "pan"; startX: number; startY: number; viewport: CanvasViewport }
  | { type: "node"; nodeId: string; startWorldX: number; startWorldY: number; nodeX: number; nodeY: number };

const canvasTheme = {
  mode: "light" as const,
  accent: "#0098b8",
  surface: "#ffffff",
  text: "#171717",
};

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
  const [nodes, setNodes] = useState<CanvasNode[]>(initialNodes);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 360, y: 92, scale: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string>("node-revenue");
  const [drag, setDrag] = useState<DragState | null>(null);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useMemo(() => {
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
    };
  }, [nodes, viewport, selectedNodeId]);

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

  function handleStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || target?.closest(".canvas-node")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNodeId("");
    setDrag({
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

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = screenToWorld({ x: event.clientX, y: event.clientY }, viewport);
    setSelectedNodeId(node.id);
    bringToFront(node.id);
    setDrag({
      type: "node",
      nodeId: node.id,
      startWorldX: world.x,
      startWorldY: world.y,
      nodeX: node.x,
      nodeY: node.y,
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }

    if (drag.type === "pan") {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + event.clientX - drag.startX,
        y: drag.viewport.y + event.clientY - drag.startY,
      });
      return;
    }

    const world = screenToWorld({ x: event.clientX, y: event.clientY }, viewport);
    updateNodePosition(drag.nodeId, drag.nodeX + world.x - drag.startWorldX, drag.nodeY + world.y - drag.startWorldY);
  }

  function endDrag() {
    setDrag(null);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    setViewport((current) => zoomAt(current, { x: event.clientX, y: event.clientY }, current.scale * delta));
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
      ? { x: rect.left + rect.width / 2 - 140, y: rect.top + rect.height / 2 - 85 }
      : { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 85 };
    const world = screenToWorld(center, viewport);
    const next = createMetricNode(nodes.length, world);
    setNodes((current) => [...current, next]);
    setSelectedNodeId(next.id);
  }

  function resetView() {
    setViewport({ x: 360, y: 92, scale: 1 });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Boards">
        <div className="window-dots" aria-hidden="true">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div className="sidebar-title">Boards</div>
        <nav className="board-list">
          <button className="board-item active">
            <PanelsTopLeft size={18} />
            <span>Artifact Canvas</span>
            <strong>{nodes.length}</strong>
          </button>
          <button className="board-item">
            <Database size={18} />
            <span>Data Sources</span>
            <strong>2</strong>
          </button>
          <button className="board-item">
            <Sparkles size={18} />
            <span>AI Drafts</span>
            <strong>1</strong>
          </button>
        </nav>
      </aside>

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
          </div>
          <button type="button" className="primary-action" onClick={addArtifact} data-testid="add-artifact">
            <Plus size={18} />
            Add artifact
          </button>
        </header>

        <div
          ref={stageRef}
          className="canvas-stage"
          data-testid="canvas-stage"
          data-scale={viewport.scale.toFixed(3)}
          data-selected-node={selectedNodeId}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={handleWheel}
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
                  style={{
                    width: node.width,
                    height: node.height,
                    transform: `translate(${node.x}px, ${node.y}px)`,
                    zIndex: node.zIndex,
                  }}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
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
            <button type="button" className="icon-button" onClick={() => changeZoom(0.9)} title="Zoom out">
              <ZoomOut size={19} />
            </button>
            <span data-testid="zoom-level">{Math.round(viewport.scale * 100)}%</span>
            <button type="button" className="icon-button" onClick={() => changeZoom(1.1)} title="Zoom in">
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
    };
  }
}
