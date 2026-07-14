import { ArrowDown, ArrowUp, Copy, EllipsisVertical, GripVertical, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspacePreviewNode, WorkspaceSummary } from "../../workspaces/types";

interface CanvasSidebarProps {
  activeViewId: string;
  views: WorkspaceSummary[];
  onClose: () => void;
  onCreateView: () => void;
  onDeleteView: (id: string) => void;
  onDuplicateView: (id: string) => void;
  onReorderView: (sourceId: string, targetId: string) => void;
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

export function CanvasSidebar({
  activeViewId,
  views,
  onClose,
  onCreateView,
  onDeleteView,
  onDuplicateView,
  onReorderView,
  onSelectView,
}: CanvasSidebarProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuViewId, setMenuViewId] = useState("");
  const [draggedViewId, setDraggedViewId] = useState("");
  const [dropViewId, setDropViewId] = useState("");

  useEffect(() => {
    if (!menuViewId) return;
    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuViewId("");
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuViewId("");
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menuViewId]);

  const draggedIndex = views.findIndex((view) => view.id === draggedViewId);

  function dropClassFor(viewId: string, index: number) {
    if (viewId !== dropViewId) return "";
    return `drop-target ${draggedIndex < index ? "drop-after" : "drop-before"}`;
  }

  return (
    <>
      <button type="button" className="sidebar-backdrop" aria-label="Close views" onClick={onClose} />
      <aside className="canvas-sidebar" aria-label="Views" data-testid="canvas-sidebar">
        <header>
          <span>Views</span>
          <div className="sidebar-header-actions">
            <button type="button" className="icon-button" title="New view" data-testid="create-view" onClick={onCreateView}>
              <Plus size={18} />
            </button>
            <button type="button" className="icon-button sidebar-close" title="Close views" data-testid="close-views" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        <nav>
          {views.map((view, index) => (
            <div
              key={view.id}
              className={`view-item ${view.id === activeViewId ? "active" : ""} ${dropClassFor(view.id, index)}`}
              draggable
              data-view-id={view.id}
              onDragStart={(event) => {
                setDraggedViewId(view.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/freeform-view", view.id);
              }}
              onDragEnd={() => {
                setDraggedViewId("");
                setDropViewId("");
              }}
              onDragOver={(event) => {
                if (!draggedViewId || draggedViewId === view.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropViewId(view.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropViewId("");
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/freeform-view") || draggedViewId;
                if (sourceId) onReorderView(sourceId, view.id);
                setDraggedViewId("");
                setDropViewId("");
              }}
            >
              <button
                type="button"
                className="view-select"
                aria-current={view.id === activeViewId ? "page" : undefined}
                data-testid={`view-${view.id}`}
                onClick={() => onSelectView(view.id)}
              >
                <ViewPreview view={view} />
                <span className="view-name">
                  <span className="view-status-dot" aria-hidden="true" />
                  <span className="view-label">{view.title}</span>
                </span>
              </button>
              <span className="view-drag-handle" aria-hidden="true"><GripVertical size={15} /></span>
              <div ref={menuViewId === view.id ? menuRef : undefined} className="view-menu-wrap">
                <button
                  type="button"
                  className="view-menu-toggle"
                  title={`Actions for ${view.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuViewId === view.id}
                  data-testid={`view-menu-${view.id}`}
                  onClick={() => setMenuViewId((current) => current === view.id ? "" : view.id)}
                >
                  <EllipsisVertical size={16} />
                </button>
                {menuViewId === view.id ? (
                  <div className="view-menu" role="menu">
                    <button type="button" role="menuitem" data-testid={`duplicate-view-${view.id}`} onClick={() => { setMenuViewId(""); onDuplicateView(view.id); }}>
                      <Copy size={15} /><span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={index === 0}
                      data-testid={`move-view-up-${view.id}`}
                      onClick={() => { setMenuViewId(""); onReorderView(view.id, views[index - 1].id); }}
                    >
                      <ArrowUp size={15} /><span>Move up</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={index === views.length - 1}
                      data-testid={`move-view-down-${view.id}`}
                      onClick={() => { setMenuViewId(""); onReorderView(view.id, views[index + 1].id); }}
                    >
                      <ArrowDown size={15} /><span>Move down</span>
                    </button>
                    <button
                      type="button"
                      className="danger"
                      role="menuitem"
                      disabled={views.length <= 1}
                      data-testid={`delete-view-${view.id}`}
                      onClick={() => { setMenuViewId(""); onDeleteView(view.id); }}
                    >
                      <Trash2 size={15} /><span>Delete</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
