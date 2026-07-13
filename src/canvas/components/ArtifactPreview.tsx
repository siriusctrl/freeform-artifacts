import { AppWindow } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArtifactContent } from "../../artifacts/ArtifactContent";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasTheme } from "../../artifacts/types";
import type { ArtifactCatalogItem } from "../artifactCatalog";

interface ArtifactPreviewProps {
  active: boolean;
  artifact?: RegisteredArtifact;
  canvasTheme: CanvasTheme;
  item: ArtifactCatalogItem;
}

const PREVIEW_INSET = 12;

export function ArtifactPreview({ active, artifact, canvasTheme, item }: ArtifactPreviewProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [scale, setScale] = useState(0);
  const baseSize = artifact?.defaultSize ?? { width: 320, height: 200 };
  const previewNode = useMemo<CanvasNode>(() => ({
    id: `preview-${item.id}`,
    artifactId: item.artifactId,
    title: item.node.title,
    x: 0,
    y: 0,
    width: baseSize.width,
    height: baseSize.height,
    zIndex: 0,
    data: item.node.data,
    config: item.node.config,
    dataBinding: item.node.dataBinding,
  }), [baseSize.height, baseSize.width, item]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!active || !frame) {
      setIntersecting(false);
      return;
    }
    const scrollRoot = frame.closest<HTMLElement>(".artifact-library-list");
    const observer = new IntersectionObserver(
      ([entry]) => setIntersecting(entry.isIntersecting),
      { root: scrollRoot, rootMargin: "160px 0px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const syncScale = () => {
      const width = Math.max(0, frame.clientWidth - PREVIEW_INSET * 2);
      const height = Math.max(0, frame.clientHeight - PREVIEW_INSET * 2);
      const nextScale = Math.min(1, width / baseSize.width, height / baseSize.height);
      setScale(Number.isFinite(nextScale) ? nextScale : 0);
    };
    const observer = new ResizeObserver(syncScale);
    observer.observe(frame);
    syncScale();
    return () => observer.disconnect();
  }, [baseSize.height, baseSize.width]);

  const shouldRender = active && intersecting && scale > 0;
  return (
    <div
      ref={frameRef}
      className="artifact-preview"
      role="img"
      aria-label={`${item.title} preview`}
      data-testid={`artifact-preview-${item.artifactId}`}
      data-preview-ready={shouldRender ? "true" : "false"}
      data-preview-scale={scale || undefined}
    >
      {shouldRender ? (
        <div
          className="artifact-preview-node"
          aria-hidden="true"
          inert
          style={{
            width: baseSize.width,
            height: baseSize.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <div className="node-chrome">
            <div className="node-title">
              <AppWindow size={14} />
              <span>{item.node.title}</span>
            </div>
          </div>
          <div className="node-body">
            <ArtifactContent
              artifact={artifact}
              canvasTheme={canvasTheme}
              node={previewNode}
              previewId={item.id}
              renderSize={{ width: baseSize.width, height: Math.max(0, baseSize.height - 32) }}
            />
          </div>
        </div>
      ) : (
        <span className="artifact-preview-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
