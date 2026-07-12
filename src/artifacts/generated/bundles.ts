import { z } from "zod";
import { assertArtifactDefinition } from "../definitionValidation";
import type { ArtifactRegistryLoadResult, RegisteredArtifact } from "../registryTypes";
import { ARTIFACT_PACKAGE_STORE, openDatabase } from "../../workspaces/storage";

export const artifactBundleSchema = z.object({
  version: z.literal(1),
  artifactId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  moduleSource: z.string().min(1).max(500_000),
  node: z.object({
    title: z.string().trim().min(1).max(80),
    data: z.unknown(),
    config: z.record(z.string(), z.unknown()).default({}),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
});

export type ArtifactBundle = z.infer<typeof artifactBundleSchema>;

interface ArtifactModule {
  artifact?: RegisteredArtifact;
  default?: RegisteredArtifact;
}

async function importBundleArtifact(bundle: ArtifactBundle): Promise<RegisteredArtifact> {
  const objectUrl = URL.createObjectURL(new Blob([bundle.moduleSource], { type: "text/javascript" }));
  try {
    const module = await import(/* @vite-ignore */ objectUrl) as ArtifactModule;
    const artifact = module.artifact ?? module.default;
    assertArtifactDefinition(artifact, bundle.artifactId);
    return artifact;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function readBundle(artifactId: string): Promise<ArtifactBundle | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(ARTIFACT_PACKAGE_STORE, "readonly").objectStore(ARTIFACT_PACKAGE_STORE).get(artifactId);
      request.onsuccess = () => {
        const parsed = artifactBundleSchema.safeParse(request.result);
        resolve(parsed.success ? parsed.data : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to inspect installed artifact"));
    });
  } finally {
    database.close();
  }
}

export async function prepareArtifactBundle(
  value: unknown,
  existingRegistry: Record<string, RegisteredArtifact>,
) {
  const bundle = artifactBundleSchema.parse(value);
  const artifact = await importBundleArtifact(bundle);
  const installed = await readBundle(bundle.artifactId);
  if (installed && installed.moduleSource !== bundle.moduleSource) {
    throw new Error(
      `Artifact id ${bundle.artifactId} is already installed with different code; use a new artifactId`,
    );
  }
  if (!installed && existingRegistry[bundle.artifactId]) {
    throw new Error(`Artifact id ${bundle.artifactId} is reserved by the host; use a new artifactId`);
  }
  return { artifact, bundle };
}

export async function loadInstalledArtifactRegistry(): Promise<ArtifactRegistryLoadResult> {
  const database = await openDatabase();
  let values: unknown[];
  try {
    values = await new Promise((resolve, reject) => {
      const request = database.transaction(ARTIFACT_PACKAGE_STORE, "readonly").objectStore(ARTIFACT_PACKAGE_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to load installed artifacts"));
    });
  } finally {
    database.close();
  }

  const entries = await Promise.allSettled(values.map(async (value) => {
    const bundle = artifactBundleSchema.parse(value);
    const artifact = await importBundleArtifact(bundle);
    return [artifact.id, artifact] as const;
  }));
  const registry: Record<string, RegisteredArtifact> = {};
  const diagnostics: string[] = [];
  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      registry[entry.value[0]] = entry.value[1];
    } else {
      diagnostics.push(entry.reason instanceof Error ? entry.reason.message : "Installed artifact failed to load");
    }
  }
  return { registry, diagnostics };
}

export function parseArtifactBundle(source: string) {
  return artifactBundleSchema.parse(JSON.parse(source));
}
