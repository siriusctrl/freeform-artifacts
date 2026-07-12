import { assertArtifactDefinition } from "../definitionValidation";
import type { ArtifactRegistryLoadResult, RegisteredArtifact } from "../registryTypes";

interface ExternalArtifactModule {
  artifact?: RegisteredArtifact;
  artifacts?: RegisteredArtifact[];
  default?: RegisteredArtifact;
}

function collectArtifacts(module: ExternalArtifactModule): RegisteredArtifact[] {
  const artifacts = Array.isArray(module.artifacts) ? module.artifacts : [];
  return [module.artifact, module.default, ...artifacts].filter(Boolean) as RegisteredArtifact[];
}

function normalizeManifest(value: unknown): string[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { artifacts?: unknown }).artifacts)) {
    return [];
  }

  return (value as { artifacts: unknown[] }).artifacts
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "module" in entry) {
        return (entry as { module?: unknown }).module;
      }
      return undefined;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export async function loadExternalArtifactRegistry(
  manifestUrl = new URL("artifacts/generated/manifest.json", new URL(import.meta.env.BASE_URL, window.location.origin)).href,
): Promise<ArtifactRegistryLoadResult> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (response.status === 404) {
    return { registry: {}, diagnostics: [] };
  }
  if (!response.ok) {
    throw new Error(`Unable to load external artifact manifest: ${response.status}`);
  }

  const moduleUrls = normalizeManifest(await response.json()).map((moduleUrl) => new URL(moduleUrl, manifestUrl).href);
  const modules = await Promise.allSettled(moduleUrls.map(loadExternalModule));
  const registry: Record<string, RegisteredArtifact> = {};
  const diagnostics: string[] = [];
  modules.forEach((result, index) => {
    if (result.status === "rejected") {
      diagnostics.push(`${moduleUrls[index]}: ${result.reason instanceof Error ? result.reason.message : "load failed"}`);
      return;
    }
    for (const artifact of collectArtifacts(result.value)) {
      try {
        assertArtifactDefinition(artifact);
        registry[artifact.id] = artifact;
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : `Invalid artifact from ${moduleUrls[index]}`);
      }
    }
  });

  return { registry, diagnostics };
}

async function loadExternalModule(moduleUrl: string): Promise<ExternalArtifactModule> {
  const response = await fetch(moduleUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load external artifact module ${moduleUrl}: ${response.status}`);
  }

  const source = await response.text();
  const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ objectUrl) as ExternalArtifactModule;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
