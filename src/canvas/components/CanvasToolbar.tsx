import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowDownToLine,
  Database,
  Ellipsis,
  Frame,
  Grid3X3,
  LibraryBig,
  Moon,
  PanelLeft,
  RotateCcw,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import type { ThemeMode } from "../constants";

interface CanvasToolbarProps {
  importInputRef: RefObject<HTMLInputElement | null>;
  status: string;
  storageMode: "indexeddb" | "localstorage";
  viewTitle: string;
  sidebarOpen: boolean;
  artifactLibraryOpen: boolean;
  themeMode: ThemeMode;
  snapToGrid: boolean;
  onBuildArtifact: () => void;
  onToggleArtifactLibrary: () => void;
  onExportWorkspace: () => void;
  onImportData: () => void;
  onImportWorkspace: (file: File) => void;
  onResetWorkspace: () => void;
  onRenameView: (title: string) => void;
  onThemeToggle: () => void;
  onToggleSidebar: () => void;
  onToggleSnapToGrid: () => void;
}

export function CanvasToolbar({
  importInputRef,
  status,
  storageMode,
  viewTitle,
  sidebarOpen,
  artifactLibraryOpen,
  themeMode,
  snapToGrid,
  onBuildArtifact,
  onToggleArtifactLibrary,
  onExportWorkspace,
  onImportData,
  onImportWorkspace,
  onResetWorkspace,
  onRenameView,
  onThemeToggle,
  onToggleSidebar,
  onToggleSnapToGrid,
}: CanvasToolbarProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(viewTitle);

  useEffect(() => setTitleDraft(viewTitle), [viewTitle]);

  function commitTitle() {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== viewTitle) onRenameView(nextTitle);
    else setTitleDraft(viewTitle);
    setEditingTitle(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="title-block">
        <button
          type="button"
          className={`icon-button sidebar-toggle ${sidebarOpen ? "active" : ""}`}
          title={`${sidebarOpen ? "Hide" : "Show"} views (Cmd/Ctrl+B)`}
          aria-pressed={sidebarOpen}
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={18} />
        </button>
        <Frame size={20} />
        <div>
          <span>Freeform Artifacts</span>
        </div>
      </div>
      <div className="canvas-title-slot">
        {editingTitle ? (
          <input
            autoFocus
            data-testid="canvas-title-input"
            value={titleDraft}
            maxLength={80}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTitle();
              if (event.key === "Escape") {
                setTitleDraft(viewTitle);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            data-testid="canvas-title"
            title="Rename canvas"
            onDoubleClick={() => setEditingTitle(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "F2") {
                event.preventDefault();
                setEditingTitle(true);
              }
            }}
          >
            {viewTitle}
          </button>
        )}
      </div>
      <div className="topbar-controls">
        <div className="status-pill" data-testid="board-status" title={`${status}. Storage: ${storageMode === "indexeddb" ? "IndexedDB" : "localStorage fallback"}`}>
          <span className="status-mark" aria-hidden="true" /><span>{status}</span>
        </div>
        <div className="tool-strip" aria-label="Canvas tools">
          <input
            ref={importInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            data-testid="workspace-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onImportWorkspace(file);
            }}
          />
          <button
            type="button"
            className="theme-toggle"
            onClick={onThemeToggle}
            title={themeMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
            data-testid="theme-toggle"
          >
            {themeMode === "light" ? <Moon size={18} /> : <Sun size={18} />}
            <span>{themeMode === "light" ? "Dark" : "Light"}</span>
          </button>
          <div ref={menuRef} className="toolbar-menu-wrap">
            <button
              type="button"
              className="icon-button"
              title="More workspace actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-testid="workspace-menu"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <Ellipsis size={18} />
            </button>
            {menuOpen ? (
              <div className="toolbar-menu" role="menu">
                <button type="button" role="menuitemcheckbox" aria-checked={snapToGrid} data-testid="snap-toggle" onClick={onToggleSnapToGrid}>
                  <Grid3X3 size={17} />
                  <span>Snap to grid</span>
                  <span className={`menu-switch ${snapToGrid ? "active" : ""}`} aria-hidden="true"><span className="menu-switch-thumb" /></span>
                </button>
                <button type="button" role="menuitem" data-testid="import-data" onClick={() => { onImportData(); setMenuOpen(false); }}>
                  <Database size={17} /><span>Load sample data</span>
                </button>
                <button type="button" role="menuitem" data-testid="import-workspace" onClick={() => { importInputRef.current?.click(); setMenuOpen(false); }}>
                  <Upload size={17} /><span>Import backup</span>
                </button>
                <button type="button" role="menuitem" data-testid="export-workspace" onClick={() => { onExportWorkspace(); setMenuOpen(false); }}>
                  <ArrowDownToLine size={17} /><span>Export backup</span>
                </button>
                <button type="button" role="menuitem" data-testid="reset-workspace" onClick={() => { onResetWorkspace(); setMenuOpen(false); }}>
                  <RotateCcw size={17} /><span>Reset demo</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`icon-button artifact-library-toggle ${artifactLibraryOpen ? "active" : ""}`}
            title="Artifacts (Shift+Cmd/Ctrl+A)"
            aria-pressed={artifactLibraryOpen}
            data-testid="artifact-library-toggle"
            onClick={onToggleArtifactLibrary}
          >
            <LibraryBig size={18} />
            <span>Artifacts</span>
          </button>
          <button type="button" className="primary-action" onClick={onBuildArtifact} data-testid="build-artifact" title="Start a private 30-minute Build Session for this view">
            <Sparkles size={17} /><span>Build with AI</span>
          </button>
        </div>
      </div>
    </header>
  );
}
