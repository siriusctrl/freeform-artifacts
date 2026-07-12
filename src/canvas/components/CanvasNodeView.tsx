import { AppWindow } from "lucide-react";
import type { PointerEvent } from "react";
import { EChartsArtifactHost } from "../../artifacts/EChartsArtifactHost";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasTheme } from "../../artifacts/types";
import { validateArtifactPayload } from "../../artifacts/validation";

interface CanvasNodeViewProps {
  artifact?: RegisteredArtifact;
  canvasTheme: CanvasTheme;
  isSelected: boolean;
  node: CanvasNode;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
}

function InvalidArtifactCard({ message }: { message?: string }) {
  return (
    <article className="artifact invalid-artifact">
      <div className="artifact-kicker">invalid artifact</div>
      <strong>Schema validation failed</strong>
      <span>{message ?? "The artifact data or config did not match its contract."}</span>
    </article>
  );
}

export function CanvasNodeView({
  artifact,
  canvasTheme,
  isSelected,
  node,
  onNodePointerDown,
  onResizePointerDown,
}: CanvasNodeViewProps) {
  const validation = validateArtifactPayload(node, artifact);
  const renderProps = {
    data: node.data,
    config: node.config,
    size: { width: node.width, height: Math.max(0, node.height - 32) },
    theme: canvasTheme,
    emit: () => undefined,
  };

  return (
    <div
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
      onPointerDown={(event) => onNodePointerDown(event, node)}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="node-chrome">
        <AppWindow size={14} />
        <span>{node.title}</span>
      </div>
      <div className="node-body">
        {!validation.ok || !artifact ? (
          <InvalidArtifactCard message={validation.message} />
        ) : artifact.renderer === "echarts" ? (
          <EChartsArtifactHost
            artifact={artifact}
            renderProps={renderProps}
          />
        ) : (
          artifact.render(renderProps)
        )}
      </div>
      {isSelected ? (
        <button
          type="button"
          className="resize-handle"
          data-testid={`resize-${node.id}`}
          title="Resize artifact"
          onPointerDown={(event) => onResizePointerDown(event, node)}
        />
      ) : null}
    </div>
  );
}
