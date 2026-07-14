import type { DragEvent, PointerEvent, RefObject } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ARTIFACT_DRAG_TYPE } from "../artifactCatalog";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasTheme, CanvasViewport } from "../../artifacts/types";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";
import { CanvasNodeView } from "./CanvasNodeView";
import { SelectionToolbar } from "./SelectionToolbar";
import { ZoomControls } from "./ZoomControls";
import type { LayoutAction, SelectionRect } from "../selection";

interface CanvasBoardProps {
  canvasTheme: CanvasTheme;
  nodes: CanvasNode[];
  runtimeArtifactRegistry: Record<string, RegisteredArtifact>;
  selectedNodeIds: string[];
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewport;
  artifactDragActive: boolean;
  hasMultipleViews: boolean;
  presentationMode: boolean;
  onChangeZoom: (factor: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onExitPresentation: () => void;
  onLayoutSelection: (action: LayoutAction) => void;
  onNextPresentationView: () => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResetView: () => void;
  onPreviousPresentationView: () => void;
  onArtifactDrop: (catalogItemId: string, clientX: number, clientY: number) => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
  onStagePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  selectionRect: SelectionRect | null;
}

export function CanvasBoard({
  canvasTheme,
  nodes,
  runtimeArtifactRegistry,
  selectedNodeIds,
  stageRef,
  viewport,
  artifactDragActive,
  hasMultipleViews,
  presentationMode,
  onChangeZoom,
  onDeleteNode,
  onDeleteSelection,
  onDuplicateSelection,
  onExitPresentation,
  onLayoutSelection,
  onNextPresentationView,
  onNodePointerDown,
  onResetView,
  onPreviousPresentationView,
  onArtifactDrop,
  onResizePointerDown,
  onStagePointerDown,
  selectionRect,
}: CanvasBoardProps) {
  const selectedNodeId = selectedNodeIds.at(-1) ?? "";
  return (
    <div
      ref={stageRef}
      tabIndex={0}
      aria-label="Canvas"
      className={`canvas-stage ${artifactDragActive ? "artifact-drop-active" : ""} ${presentationMode ? "presentation" : ""}`}
      data-testid="canvas-stage"
      data-scale={viewport.scale.toFixed(3)}
      data-selected-node={selectedNodeId}
      data-selected-count={selectedNodeIds.length}
      onPointerDown={onStagePointerDown}
      onDragStart={(event) => event.preventDefault()}
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        if (presentationMode || !event.dataTransfer.types.includes(ARTIFACT_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        const catalogItemId = event.dataTransfer.getData(ARTIFACT_DRAG_TYPE);
        if (presentationMode || !catalogItemId) return;
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
            isPresentation={presentationMode}
            isSelected={!presentationMode && selectedNodeIds.includes(node.id)}
            node={node}
            onDeleteNode={onDeleteNode}
            onNodePointerDown={onNodePointerDown}
            onResizePointerDown={onResizePointerDown}
            showSelectionControls={selectedNodeIds.length === 1}
          />
        ))}
      </div>
      {selectionRect && !presentationMode ? (
        <div
          className="selection-marquee"
          data-testid="selection-marquee"
          style={{
            left: viewport.x + selectionRect.x * viewport.scale,
            top: viewport.y + selectionRect.y * viewport.scale,
            width: selectionRect.width * viewport.scale,
            height: selectionRect.height * viewport.scale,
          }}
        />
      ) : null}
      {selectedNodeIds.length > 1 && !presentationMode ? (
        <SelectionToolbar
          count={selectedNodeIds.length}
          onDelete={onDeleteSelection}
          onDuplicate={onDuplicateSelection}
          onLayout={onLayoutSelection}
        />
      ) : null}
      {presentationMode ? (
        <div className="presentation-controls" role="toolbar" aria-label="Presentation controls" data-testid="presentation-controls">
          <button
            type="button"
            title="Previous view"
            aria-label="Previous view"
            disabled={!hasMultipleViews}
            onClick={onPreviousPresentationView}
          >
            <ChevronLeft size={19} />
          </button>
          <button type="button" title="Exit presentation" aria-label="Exit presentation" data-testid="exit-presentation" onClick={onExitPresentation}>
            <X size={19} />
          </button>
          <button
            type="button"
            title="Next view"
            aria-label="Next view"
            disabled={!hasMultipleViews}
            onClick={onNextPresentationView}
          >
            <ChevronRight size={19} />
          </button>
        </div>
      ) : null}
      {!presentationMode ? (
        <ZoomControls scale={viewport.scale} onChangeZoom={onChangeZoom} onResetView={onResetView} />
      ) : null}
    </div>
  );
}
