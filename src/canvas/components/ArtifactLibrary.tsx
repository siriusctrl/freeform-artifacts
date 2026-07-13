import { Blocks, ChartNoAxesCombined, Gauge, Plus, Search, Sparkles, Table2, Waypoints, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ARTIFACT_DRAG_TYPE, type ArtifactCatalogItem } from "../artifactCatalog";

interface ArtifactLibraryProps {
  builtIn: ArtifactCatalogItem[];
  open: boolean;
  personal: ArtifactCatalogItem[];
  onAdd: (item: ArtifactCatalogItem) => void;
  onBuildArtifact: () => void;
  onClose: () => void;
  onDragEnd: () => void;
  onDragStart: (item: ArtifactCatalogItem) => void;
}

function ArtifactGlyph({ artifactId, renderer }: Pick<ArtifactCatalogItem, "artifactId" | "renderer">) {
  if (artifactId === "metric-card") return <Gauge size={19} />;
  if (artifactId === "table-preview") return <Table2 size={19} />;
  if (artifactId === "flow-diagram") return <Workflow size={19} />;
  if (artifactId === "inflection-probability") return <ChartNoAxesCombined size={19} />;
  if (artifactId === "sankey-flow") return <Waypoints size={19} />;
  return renderer === "React" ? <Blocks size={19} /> : <ChartNoAxesCombined size={19} />;
}

export function ArtifactLibrary({
  builtIn,
  open,
  personal,
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
    return items.filter((item) => `${item.title} ${item.summary} ${item.renderer}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [items, query]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus({ preventScroll: true });
  }, [open]);

  function startDrag(event: DragEvent<HTMLButtonElement>, item: ArtifactCatalogItem) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(ARTIFACT_DRAG_TYPE, item.id);
    onDragStart(item);
  }

  function moveTabFocus(nextSource: ArtifactCatalogItem["source"]) {
    setSource(nextSource);
    window.requestAnimationFrame(() => {
      (nextSource === "built-in" ? builtInTabRef.current : personalTabRef.current)?.focus();
    });
  }

  return (
    <aside className="artifact-library" aria-label="Artifacts" data-testid="artifact-library">
      <header>
        <div>
          <strong>Artifacts</strong>
          <span>{builtIn.length + personal.length}</span>
        </div>
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
          <button
            key={item.id}
            type="button"
            className="artifact-library-item"
            draggable
            title={`Add ${item.title}`}
            data-testid={`artifact-library-item-${item.artifactId}`}
            onClick={() => onAdd(item)}
            onDragStart={(event) => startDrag(event, item)}
            onDragEnd={onDragEnd}
          >
            <span className="artifact-library-glyph"><ArtifactGlyph artifactId={item.artifactId} renderer={item.renderer} /></span>
            <span className="artifact-library-copy">
              <strong>{item.title}</strong>
              <span>{item.summary}</span>
              <small>{item.renderer}</small>
            </span>
            <Plus size={17} aria-hidden="true" />
          </button>
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
