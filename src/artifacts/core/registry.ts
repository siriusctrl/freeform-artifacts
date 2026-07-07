import { metricCardArtifact } from "./MetricCard";
import { tablePreviewArtifact } from "./TablePreview";
import type { RegisteredArtifact } from "../registryTypes";

export const coreArtifactRegistry: Record<string, RegisteredArtifact> = {
  [metricCardArtifact.id]: metricCardArtifact,
  [tablePreviewArtifact.id]: tablePreviewArtifact,
};
