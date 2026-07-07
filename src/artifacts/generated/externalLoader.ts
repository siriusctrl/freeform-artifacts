import type { RegisteredArtifact } from "../registryTypes";

interface ExternalArtifactManifest {
  artifacts?: Array<string | { module: string }>;
}

interface ExternalArtifactModule {
  artifact?: RegisteredArtifact;
  artifacts?: RegisteredArtifact[];
  default?: RegisteredArtifact;
}

function collectArtifacts(module: ExternalArtifactModule): RegisteredArtifact[] {
  return [module.artifact, module.default, ...(module.artifacts ?? [])].filter(Boolean) as RegisteredArtifact[];
}

function normalizeManifest(value: unknown): string[] {
  const manifest = value as ExternalArtifactManifest;
  if (!Array.isArray(manifest.artifacts)) {
    return [];
  }

  return manifest.artifacts
    .map((entry) => (typeof entry === "string" ? entry : entry.module))
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export async function loadExternalArtifactRegistry(
  manifestUrl = "/artifacts/generated/manifest.json",
): Promise<Record<string, RegisteredArtifact>> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new Error(`Unable to load external artifact manifest: ${response.status}`);
  }

  const moduleUrls = normalizeManifest(await response.json());
  const modules = await Promise.all(moduleUrls.map(loadExternalModule));

  return Object.fromEntries(
    modules
      .flatMap(collectArtifacts)
      .map((artifact) => [artifact.id, artifact]),
  );
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
