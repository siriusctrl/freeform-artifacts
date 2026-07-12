import type { PointerEvent, RefObject } from "react";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasTheme, CanvasViewport } from "../../artifacts/types";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";
import { CanvasNodeView } from "./CanvasNodeView";
import { ZoomControls } from "./ZoomControls";

interface CanvasBoardProps {
  canvasTheme: CanvasTheme;
  nodes: CanvasNode[];
  runtimeArtifactRegistry: Record<string, RegisteredArtifact>;
  selectedNodeId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewport;
  onChangeZoom: (factor: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResetView: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
  onStagePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}

export function CanvasBoard({
  canvasTheme,
  nodes,
  runtimeArtifactRegistry,
  selectedNodeId,
  stageRef,
  viewport,
  onChangeZoom,
  onDeleteNode,
  onNodePointerDown,
  onResetView,
  onResizePointerDown,
  onStagePointerDown,
}: CanvasBoardProps) {
  return (
    <div
      ref={stageRef}
      className="canvas-stage"
      data-testid="canvas-stage"
      data-scale={viewport.scale.toFixed(3)}
      data-selected-node={selectedNodeId}
      onPointerDown={onStagePointerDown}
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        className="grid-plane"
        data-testid="grid-plane"
        style={{
          backgroundSize: `${CANVAS_GRID_SIZE * viewport.scale}px ${CANVAS_GRID_SIZE * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />
      <div
        className="canvas-world"
        data-testid="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {nodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            artifact={runtimeArtifactRegistry[node.artifactId]}
            canvasTheme={canvasTheme}
            isSelected={node.id === selectedNodeId}
            node={node}
            onDeleteNode={onDeleteNode}
            onNodePointerDown={onNodePointerDown}
            onResizePointerDown={onResizePointerDown}
          />
        ))}
      </div>

      <ZoomControls scale={viewport.scale} onChangeZoom={onChangeZoom} onResetView={onResetView} />
    </div>
  );
}
