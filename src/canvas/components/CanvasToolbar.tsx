import { ArrowDownToLine, Database, Frame, Grid3X3, Moon, MousePointer2, Plus, Sun } from "lucide-react";
import type { ThemeMode } from "../constants";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";

interface CanvasToolbarProps {
  status: string;
  themeMode: ThemeMode;
  snapToGrid: boolean;
  onAddArtifact: () => void;
  onExportBoard: () => void;
  onImportData: () => void;
  onThemeToggle: () => void;
  onToggleSnapToGrid: () => void;
}

export function CanvasToolbar({
  status,
  themeMode,
  snapToGrid,
  onAddArtifact,
  onExportBoard,
  onImportData,
  onThemeToggle,
  onToggleSnapToGrid,
}: CanvasToolbarProps) {
  return (
    <header className="topbar">
      <div className="title-block">
        <Frame size={22} />
        <span>Freeform Artifacts</span>
      </div>
      <div className="tool-strip" aria-label="Canvas tools">
        <button type="button" className="icon-button active" title="Select">
          <MousePointer2 size={20} />
        </button>
        <button
          type="button"
          className={`icon-button ${snapToGrid ? "active" : ""}`}
          title={snapToGrid ? `Snap to ${CANVAS_GRID_SIZE}px grid is on` : "Snap to grid is off"}
          aria-pressed={snapToGrid}
          onClick={onToggleSnapToGrid}
          data-testid="snap-toggle"
        >
          <Grid3X3 size={20} />
        </button>
        <button type="button" className="icon-button" title="Import data" onClick={onImportData} data-testid="import-data">
          <Database size={20} />
        </button>
        <button type="button" className="icon-button" title="Export board" onClick={onExportBoard} data-testid="export-board">
          <ArrowDownToLine size={20} />
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={onThemeToggle}
          title={themeMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
          data-testid="theme-toggle"
        >
          {themeMode === "light" ? <Moon size={20} /> : <Sun size={20} />}
          <span>{themeMode === "light" ? "Dark" : "Light"}</span>
        </button>
      </div>
      <div className="topbar-actions">
        <div className="status-pill" data-testid="board-status">
          {status}
        </div>
        <button type="button" className="primary-action" onClick={onAddArtifact} data-testid="add-artifact">
          <Plus size={18} />
          <span>Add artifact</span>
        </button>
      </div>
    </header>
  );
}
