import type { DragEvent, PointerEvent, RefObject } from "react";
import { ARTIFACT_DRAG_TYPE } from "../artifactCatalog";
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
  artifactDragActive: boolean;
  onChangeZoom: (factor: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResetView: () => void;
  onArtifactDrop: (catalogItemId: string, clientX: number, clientY: number) => void;
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
  artifactDragActive,
  onChangeZoom,
  onDeleteNode,
  onNodePointerDown,
  onResetView,
  onArtifactDrop,
  onResizePointerDown,
  onStagePointerDown,
}: CanvasBoardProps) {
  return (
    <div
      ref={stageRef}
      tabIndex={0}
      aria-label="Canvas"
      className={`canvas-stage ${artifactDragActive ? "artifact-drop-active" : ""}`}
      data-testid="canvas-stage"
      data-scale={viewport.scale.toFixed(3)}
      data-selected-node={selectedNodeId}
      onPointerDown={onStagePointerDown}
      onDragStart={(event) => event.preventDefault()}
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(ARTIFACT_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        const catalogItemId = event.dataTransfer.getData(ARTIFACT_DRAG_TYPE);
        if (!catalogItemId) return;
        event.preventDefault();
        onArtifactDrop(catalogItemId, event.clientX, event.clientY);
      }}
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
