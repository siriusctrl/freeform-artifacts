import { LayoutDashboard, Plus } from "lucide-react";
import type { WorkspaceSummary } from "../../workspaces/types";

interface CanvasSidebarProps {
  activeViewId: string;
  views: WorkspaceSummary[];
  onCreateView: () => void;
  onSelectView: (id: string) => void;
}

export function CanvasSidebar({ activeViewId, views, onCreateView, onSelectView }: CanvasSidebarProps) {
  return (
    <aside className="canvas-sidebar" aria-label="Canvases" data-testid="canvas-sidebar">
      <header>
        <span>Canvases</span>
        <button type="button" className="icon-button" title="New canvas" data-testid="create-view" onClick={onCreateView}>
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
            <LayoutDashboard size={16} />
            <span>{view.title}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
