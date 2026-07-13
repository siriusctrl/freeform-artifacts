import { ArtifactErrorBoundary } from "./ArtifactErrorBoundary";
import { ChartKitArtifactHost } from "./ChartKitArtifactHost";
import { EChartsArtifactHost } from "./EChartsArtifactHost";
import type { RegisteredArtifact } from "./registryTypes";
import type { ArtifactSize, CanvasNode, CanvasTheme } from "./types";
import { validateArtifactPayload } from "./validation";

interface ArtifactContentProps {
  artifact?: RegisteredArtifact;
  canvasTheme: CanvasTheme;
  node: CanvasNode;
  previewId?: string;
  renderSize: ArtifactSize;
}

function ArtifactRenderer({
  artifact,
  previewId,
  renderProps,
}: {
  artifact: RegisteredArtifact;
  previewId?: string;
  renderProps: {
    data: unknown;
    config: CanvasNode["config"];
    size: ArtifactSize;
    theme: CanvasTheme;
  };
}) {
  return artifact.renderer === "echarts" ? (
    <EChartsArtifactHost
      artifact={artifact}
      preview={Boolean(previewId)}
      renderProps={renderProps}
      testIdPrefix={previewId ? "preview-echarts" : undefined}
    />
  ) : artifact.renderer === "chart-kit" ? (
    <ChartKitArtifactHost
      artifact={artifact}
      preview={Boolean(previewId)}
      renderProps={renderProps}
      testIdPrefix={previewId ? "preview-echarts" : undefined}
    />
  ) : (
    artifact.render(renderProps)
  );
}

function InvalidArtifactCard({ message }: { message?: string }) {
  return (
    <article className="artifact invalid-artifact">
      <div className="artifact-kicker">artifact unavailable</div>
      <strong>Unable to render this artifact</strong>
      <span>{message ?? "The artifact data or config did not match its contract."}</span>
    </article>
  );
}

export function ArtifactContent({
  artifact,
  canvasTheme,
  node,
  previewId,
  renderSize,
}: ArtifactContentProps) {
  const validation = validateArtifactPayload(node, artifact);
  if (!validation.ok || !artifact) {
    return <InvalidArtifactCard message={validation.message} />;
  }

  const renderProps = {
    data: node.data,
    config: node.config,
    size: renderSize,
    theme: canvasTheme,
  };
  return (
    <ArtifactErrorBoundary
      key={`${artifact.id}:${artifact.version}:${previewId ?? "canvas"}`}
      fallback={(message) => <InvalidArtifactCard message={message} />}
    >
      <ArtifactRenderer artifact={artifact} previewId={previewId} renderProps={renderProps} />
    </ArtifactErrorBoundary>
  );
}
