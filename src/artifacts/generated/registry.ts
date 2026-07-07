import type { RegisteredArtifact } from "../registryTypes";

interface LocalGeneratedModule {
  artifact?: RegisteredArtifact;
  artifacts?: RegisteredArtifact[];
  default?: RegisteredArtifact;
}

const localGeneratedModules = import.meta.glob<LocalGeneratedModule>("./**/*.artifact.{ts,tsx}", {
  eager: true,
});

function collectArtifacts(module: LocalGeneratedModule): RegisteredArtifact[] {
  return [module.artifact, module.default, ...(module.artifacts ?? [])].filter(Boolean) as RegisteredArtifact[];
}

export const generatedArtifactRegistry: Record<string, RegisteredArtifact> = Object.fromEntries(
  Object.values(localGeneratedModules)
    .flatMap(collectArtifacts)
    .map((artifact) => [artifact.id, artifact]),
);
