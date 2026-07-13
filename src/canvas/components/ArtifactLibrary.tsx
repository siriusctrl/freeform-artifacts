import { GripVertical, Plus, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasTheme } from "../../artifacts/types";
import { ARTIFACT_DRAG_TYPE, type ArtifactCatalogItem } from "../artifactCatalog";
import { ArtifactPreview } from "./ArtifactPreview";

interface ArtifactLibraryProps {
  builtIn: ArtifactCatalogItem[];
  canvasTheme: CanvasTheme;
  open: boolean;
  personal: ArtifactCatalogItem[];
  registry: Record<string, RegisteredArtifact>;
  onAdd: (item: ArtifactCatalogItem) => void;
  onBuildArtifact: () => void;
  onClose: () => void;
  onDragEnd: () => void;
  onDragStart: (item: ArtifactCatalogItem) => void;
}

export function ArtifactLibrary({
  builtIn,
  canvasTheme,
  open,
  personal,
  registry,
  onAdd,
  onBuildArtifact,
  onClose,
  onDragEnd,
  onDragStart,
}: ArtifactLibraryProps) {
  const [source, setSource] = useState<ArtifactCatalogItem["source"]>("built-in");
  const [query, setQuery] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const builtInTabRef = useRef<HTMLButtonElement | null>(null);
  const personalTabRef = useRef<HTMLButtonElement | null>(null);
  const items = source === "built-in" ? builtIn : personal;
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [items, query]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus({ preventScroll: true });
  }, [open]);

  function startDrag(event: DragEvent<HTMLElement>, item: ArtifactCatalogItem) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(ARTIFACT_DRAG_TYPE, item.id);
    onDragStart(item);
  }

  function moveTabFocus(nextSource: ArtifactCatalogItem["source"]) {
    setSource(nextSource);
    (nextSource === "built-in" ? builtInTabRef.current : personalTabRef.current)?.focus();
  }

  function addFromKeyboard(event: KeyboardEvent<HTMLElement>, item: ArtifactCatalogItem) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onAdd(item);
  }

  return (
    <aside className="artifact-library" aria-label="Artifacts" data-testid="artifact-library">
      <header>
        <strong>Artifacts</strong>
        <button ref={closeButtonRef} type="button" className="icon-button" title="Close artifacts" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="artifact-library-tabs" role="tablist" aria-label="Artifact source">
        <button
          ref={builtInTabRef}
          type="button"
          role="tab"
          aria-selected={source === "built-in"}
          tabIndex={source === "built-in" ? 0 : -1}
          className={source === "built-in" ? "active" : ""}
          data-testid="artifact-tab-built-in"
          onClick={() => setSource("built-in")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            moveTabFocus("personal");
          }}
        >
          <span>Built-in</span><span>{builtIn.length}</span>
        </button>
        <button
          ref={personalTabRef}
          type="button"
          role="tab"
          aria-selected={source === "personal"}
          tabIndex={source === "personal" ? 0 : -1}
          className={source === "personal" ? "active" : ""}
          data-testid="artifact-tab-personal"
          onClick={() => setSource("personal")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            moveTabFocus("built-in");
          }}
        >
          <span>Yours</span><span>{personal.length}</span>
        </button>
      </div>

      <label className="artifact-library-search">
        <Search size={16} aria-hidden="true" />
        <span className="visually-hidden">Search artifacts</span>
        <input
          type="search"
          value={query}
          placeholder="Search artifacts"
          data-testid="artifact-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            onClose();
          }}
        />
      </label>

      <div className="artifact-library-list" role="tabpanel" aria-live="polite">
        {visibleItems.map((item) => (
          <article
            key={item.id}
            className="artifact-library-item"
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Add ${item.title}`}
            title={`Add ${item.title}`}
            data-testid={`artifact-library-item-${item.artifactId}`}
            onClick={() => onAdd(item)}
            onKeyDown={(event) => addFromKeyboard(event, item)}
            onDragStart={(event) => startDrag(event, item)}
            onDragEnd={onDragEnd}
          >
            <ArtifactPreview
              active={open}
              artifact={registry[item.artifactId]}
              canvasTheme={canvasTheme}
              item={item}
            />
            <span className="artifact-library-copy">
              <span className="artifact-library-item-title">
                <strong>{item.title}</strong>
                <span className="artifact-library-item-actions" aria-hidden="true">
                  <GripVertical className="artifact-library-grip" size={15} />
                  <span className="artifact-library-add"><Plus size={16} /></span>
                </span>
              </span>
              <span>{item.summary}</span>
            </span>
          </article>
        ))}

        {!visibleItems.length && source === "personal" && !query ? (
          <div className="artifact-library-empty" data-testid="artifact-library-empty">
            <Sparkles size={20} />
            <strong>No personal artifacts</strong>
          </div>
        ) : null}
        {!visibleItems.length && (source === "built-in" || query) ? (
          <div className="artifact-library-empty"><strong>No matching artifacts</strong></div>
        ) : null}
      </div>
      <footer className="artifact-library-footer">
        <button type="button" className="secondary-action" data-testid="library-build-artifact" onClick={onBuildArtifact}>
          <Sparkles size={16} /><span>Build with AI</span>
        </button>
      </footer>
    </aside>
  );
}
