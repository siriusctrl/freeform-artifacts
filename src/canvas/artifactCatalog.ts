import type { ArtifactBundle } from "../artifacts/generated/bundles";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { DataBinding, JsonObject } from "../artifacts/types";
import { initialNodes } from "./seeds/demoBoard";

export const ARTIFACT_DRAG_TYPE = "application/x-freeform-artifact";

export interface ArtifactNodePreset {
  title: string;
  data: unknown;
  config: JsonObject;
  dataBinding?: DataBinding;
}

export interface ArtifactCatalogItem {
  id: string;
  artifactId: string;
  title: string;
  summary: string;
  source: "built-in" | "personal";
  node: ArtifactNodePreset;
}

const BUILT_IN_METADATA: Record<string, { title: string; summary: string }> = {
  "metric-card": { title: "Metric summary", summary: "A focused KPI with change context." },
  "table-preview": { title: "Data table", summary: "Compact rows for quick comparison." },
  "flow-diagram": { title: "Process flow", summary: "A clear three-step operational path." },
  "inflection-probability": { title: "Probability model", summary: "Quarterly probability and cumulative change." },
  "sankey-flow": { title: "Allocation flow", summary: "Movement from sources to destinations." },
};
const BUILT_IN_ORDER = ["metric-card", "table-preview", "flow-diagram", "inflection-probability", "sankey-flow"];

export function createArtifactCatalog(
  registry: Record<string, RegisteredArtifact>,
  personalBundles: ArtifactBundle[],
) {
  const builtIn = initialNodes.flatMap<ArtifactCatalogItem>((node) => {
    const artifact = registry[node.artifactId];
    const metadata = BUILT_IN_METADATA[node.artifactId];
    if (!artifact || !metadata) return [];
    return [{
      id: `built-in:${node.artifactId}`,
      artifactId: node.artifactId,
      title: metadata.title,
      summary: metadata.summary,
      source: "built-in",
      node: {
        title: node.title,
        data: node.data,
        config: node.config,
        dataBinding: node.dataBinding,
      },
    }];
  }).sort((first, second) => BUILT_IN_ORDER.indexOf(first.artifactId) - BUILT_IN_ORDER.indexOf(second.artifactId));

  const personal = personalBundles.flatMap<ArtifactCatalogItem>((bundle) => {
    const artifact = registry[bundle.artifactId];
    if (!artifact) return [];
    return [{
      id: `personal:${bundle.artifactId}`,
      artifactId: bundle.artifactId,
      title: artifact.title,
      summary: bundle.node.title === artifact.title ? "Personal artifact" : bundle.node.title,
      source: "personal",
      node: {
        title: bundle.node.title,
        data: bundle.node.data,
        config: bundle.node.config,
      },
    }];
  }).sort((first, second) => first.title.localeCompare(second.title));

  return { builtIn, personal };
}
