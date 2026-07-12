import type { ArtifactDefinition } from "./types";

export type RegisteredArtifact = ArtifactDefinition<any, any>;

export interface ArtifactRegistryLoadResult {
  registry: Record<string, RegisteredArtifact>;
  diagnostics: string[];
}
