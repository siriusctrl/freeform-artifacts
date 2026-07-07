import { flowDiagramArtifact } from "./FlowDiagram";
import { inflectionProbabilityArtifact } from "./InflectionProbability";
import { sankeyFlowArtifact } from "./SankeyFlow";
import type { RegisteredArtifact } from "../registryTypes";

export const exampleArtifactRegistry: Record<string, RegisteredArtifact> = {
  [flowDiagramArtifact.id]: flowDiagramArtifact,
  [inflectionProbabilityArtifact.id]: inflectionProbabilityArtifact,
  [sankeyFlowArtifact.id]: sankeyFlowArtifact,
};
