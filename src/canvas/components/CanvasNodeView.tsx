import { AppWindow, Scaling, Trash2 } from "lucide-react";
import type { PointerEvent } from "react";
import { ArtifactContent } from "../../artifacts/ArtifactContent";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasTheme } from "../../artifacts/types";
import { artifactObjectScale } from "../nodeSize";

interface CanvasNodeViewProps {
  artifact?: RegisteredArtifact;
  canvasTheme: CanvasTheme;
  isSelected: boolean;
  node: CanvasNode;
  onDeleteNode: (nodeId: string) => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
}

export function CanvasNodeView({
  artifact,
  canvasTheme,
  isSelected,
  node,
  onDeleteNode,
  onNodePointerDown,
  onResizePointerDown,
}: CanvasNodeViewProps) {
  const baseSize = artifact?.defaultSize ?? { width: node.width, height: node.height };
  const objectScale = artifactObjectScale(node, artifact);

  return (
    <div
      className={`canvas-node ${isSelected ? "selected" : ""}`}
      data-testid={`node-${node.id}`}
      data-node-id={node.id}
      draggable={false}
      style={{
        width: baseSize.width,
        height: baseSize.height,
        transform: `translate(${node.x}px, ${node.y}px) scale(${objectScale})`,
        zIndex: node.zIndex,
      }}
      onPointerDown={(event) => onNodePointerDown(event, node)}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="node-chrome">
        <div className="node-title">
          <AppWindow size={14} />
          <span>{node.title}</span>
        </div>
        {isSelected ? (
          <button
            type="button"
            className="node-delete"
            title="Delete artifact"
            data-testid={`delete-${node.id}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => onDeleteNode(node.id)}
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
      <div className="node-body">
        <ArtifactContent
          artifact={artifact}
          canvasTheme={canvasTheme}
          node={node}
          renderSize={{ width: baseSize.width, height: Math.max(0, baseSize.height - 32) }}
        />
      </div>
      {isSelected ? (
        <button
          type="button"
          className="resize-handle"
          data-testid={`resize-${node.id}`}
          title="Resize artifact"
          aria-label="Resize artifact"
          onPointerDown={(event) => onResizePointerDown(event, node)}
        >
          <Scaling size={14} />
        </button>
      ) : null}
    </div>
  );
}
