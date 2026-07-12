import { z } from "zod";
import type { RegisteredArtifact } from "../registryTypes";
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
    if (!artifact || artifact.id !== bundle.artifactId) {
      throw new Error(`Bundle must export artifact ${bundle.artifactId}`);
    }
    if (!artifact.defaultSize || typeof artifact.defaultSize.width !== "number" || typeof artifact.defaultSize.height !== "number") {
      throw new Error("Bundle artifact must declare defaultSize");
    }
    return artifact;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function writeBundle(bundle: ArtifactBundle) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ARTIFACT_PACKAGE_STORE, "readwrite");
      transaction.objectStore(ARTIFACT_PACKAGE_STORE).put({ ...bundle, installedAt: new Date().toISOString() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to store artifact bundle"));
    });
  } finally {
    database.close();
  }
}

export async function installArtifactBundle(value: unknown) {
  const bundle = artifactBundleSchema.parse(value);
  const artifact = await importBundleArtifact(bundle);
  await writeBundle(bundle);
  return { artifact, bundle };
}

export async function loadInstalledArtifactRegistry(): Promise<Record<string, RegisteredArtifact>> {
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

  const entries = await Promise.all(values.map(async (value) => {
    const bundle = artifactBundleSchema.parse(value);
    const artifact = await importBundleArtifact(bundle);
    return [artifact.id, artifact] as const;
  }));
  return Object.fromEntries(entries);
}

export function parseArtifactBundle(source: string) {
  return artifactBundleSchema.parse(JSON.parse(source));
}
