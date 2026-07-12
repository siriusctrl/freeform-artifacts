import { Plus } from "lucide-react";
import type { WorkspacePreviewNode, WorkspaceSummary } from "../../workspaces/types";

interface CanvasSidebarProps {
  activeViewId: string;
  views: WorkspaceSummary[];
  onCreateView: () => void;
  onSelectView: (id: string) => void;
}

function previewBounds(nodes: WorkspacePreviewNode[]) {
  if (nodes.length === 0) return "0 0 240 140";
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = Math.max(width, height) * 0.08;
  return `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;
}

function previewKind(artifactId: string) {
  if (artifactId.includes("table")) return "table";
  if (artifactId.includes("metric")) return "metric";
  if (artifactId.includes("flow") || artifactId.includes("sankey")) return "flow";
  return "chart";
}

function ViewPreview({ view }: { view: WorkspaceSummary }) {
  const nodes = [...view.previewNodes].sort((first, second) => first.zIndex - second.zIndex).slice(-12);
  return (
    <svg
      className={`view-preview ${nodes.length === 0 ? "empty" : ""}`}
      viewBox={previewBounds(nodes)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${view.title} preview`}
      data-testid={`view-preview-${view.id}`}
    >
      {nodes.map((node) => (
        <g key={node.id} className={`view-preview-node ${previewKind(node.artifactId)}`}>
          <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={Math.min(16, node.width * 0.04)} />
          <line
            x1={node.x + node.width * 0.08}
            y1={node.y + node.height * 0.17}
            x2={node.x + node.width * 0.54}
            y2={node.y + node.height * 0.17}
          />
          <line
            x1={node.x + node.width * 0.08}
            y1={node.y + node.height * 0.31}
            x2={node.x + node.width * 0.84}
            y2={node.y + node.height * 0.31}
          />
        </g>
      ))}
    </svg>
  );
}

export function CanvasSidebar({ activeViewId, views, onCreateView, onSelectView }: CanvasSidebarProps) {
  return (
    <aside className="canvas-sidebar" aria-label="Views" data-testid="canvas-sidebar">
      <header>
        <span>Views</span>
        <button type="button" className="icon-button" title="New view" data-testid="create-view" onClick={onCreateView}>
          <Plus size={18} />
        </button>
      </header>
      <nav>
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            className={view.id === activeViewId ? "active" : ""}
            aria-current={view.id === activeViewId ? "page" : undefined}
            data-testid={`view-${view.id}`}
            onClick={() => onSelectView(view.id)}
          >
            <ViewPreview view={view} />
            <span className="view-name"><span className="view-status-dot" aria-hidden="true" /><span className="view-label">{view.title}</span></span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
