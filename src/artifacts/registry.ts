import { coreArtifactRegistry } from "./core/registry";
import { exampleArtifactRegistry } from "./examples/registry";
import { generatedArtifactRegistry } from "./generated/registry";
import type { RegisteredArtifact } from "./registryTypes";

export const artifactRegistry: Record<string, RegisteredArtifact> = {
  ...coreArtifactRegistry,
  ...exampleArtifactRegistry,
  ...generatedArtifactRegistry,
};
