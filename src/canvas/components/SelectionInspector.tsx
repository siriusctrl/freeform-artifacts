import type { CanvasNode } from "../../artifacts/types";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";

interface SelectionInspectorProps {
  selectedNode?: CanvasNode;
  snapToGrid: boolean;
}

export function SelectionInspector({ selectedNode, snapToGrid }: SelectionInspectorProps) {
  return (
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
            <div>
              <dt>Grid</dt>
              <dd>{snapToGrid ? `${CANVAS_GRID_SIZE}px snap` : "free"}</dd>
            </div>
            {selectedNode.dataBinding ? (
              <div>
                <dt>Source</dt>
                <dd>{selectedNode.dataBinding.sourceId}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : (
        <p>No artifact selected</p>
      )}
    </aside>
  );
}
