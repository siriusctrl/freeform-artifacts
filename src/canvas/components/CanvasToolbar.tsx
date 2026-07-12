import type { RefObject } from "react";
import {
  ArrowDownToLine,
  Database,
  Frame,
  Grid3X3,
  Moon,
  MousePointer2,
  Plus,
  RotateCcw,
  Sun,
  Upload,
} from "lucide-react";
import type { ThemeMode } from "../constants";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";

interface CanvasToolbarProps {
  importInputRef: RefObject<HTMLInputElement | null>;
  status: string;
  storageMode: "indexeddb" | "localstorage";
  templateTitle: string;
  themeMode: ThemeMode;
  snapToGrid: boolean;
  onAddArtifact: () => void;
  onExportWorkspace: () => void;
  onImportData: () => void;
  onImportWorkspace: (file: File) => void;
  onResetWorkspace: () => void;
  onThemeToggle: () => void;
  onToggleSnapToGrid: () => void;
}

export function CanvasToolbar({
  importInputRef,
  status,
  storageMode,
  templateTitle,
  themeMode,
  snapToGrid,
  onAddArtifact,
  onExportWorkspace,
  onImportData,
  onImportWorkspace,
  onResetWorkspace,
  onThemeToggle,
  onToggleSnapToGrid,
}: CanvasToolbarProps) {
  return (
    <header className="topbar">
      <div className="title-block">
        <Frame size={22} />
        <div>
          <span>Freeform Artifacts</span>
          <small>{templateTitle}</small>
        </div>
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
        <button
          type="button"
          className="icon-button"
          title="Import workspace backup"
          onClick={() => importInputRef.current?.click()}
          data-testid="import-workspace"
        >
          <Upload size={20} />
        </button>
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          data-testid="workspace-file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              onImportWorkspace(file);
            }
          }}
        />
        <button
          type="button"
          className="icon-button"
          title="Export workspace backup"
          onClick={onExportWorkspace}
          data-testid="export-workspace"
        >
          <ArrowDownToLine size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Reset to the original demo"
          onClick={onResetWorkspace}
          data-testid="reset-workspace"
        >
          <RotateCcw size={20} />
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
        <div
          className="status-pill"
          data-testid="board-status"
          title={`${status}. Storage: ${storageMode === "indexeddb" ? "IndexedDB" : "localStorage fallback"}`}
        >
          <span className="status-mark" aria-hidden="true" />
          <span>{status}</span>
        </div>
        <button type="button" className="primary-action" onClick={onAddArtifact} data-testid="add-artifact">
          <Plus size={18} />
          <span>Add artifact</span>
        </button>
      </div>
    </header>
  );
}
