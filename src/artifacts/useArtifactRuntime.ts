import { useEffect, useState } from "react";
import { loadInstalledArtifacts, type ArtifactBundle } from "./generated/bundles";
import { loadExternalArtifactRegistry } from "./generated/externalLoader";
import type { RegisteredArtifact } from "./registryTypes";

export function useArtifactRuntime(
  builtInRegistry: Record<string, RegisteredArtifact>,
) {
  const [registry, setRegistry] = useState<Record<string, RegisteredArtifact>>(builtInRegistry);
  const [personalBundles, setPersonalBundles] = useState<ArtifactBundle[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadExternalArtifactRegistry(), loadInstalledArtifacts()]).then((results) => {
      if (cancelled) return;
      const nextRegistry = { ...builtInRegistry };
      const diagnostics: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          Object.assign(nextRegistry, result.value.registry);
          diagnostics.push(...result.value.diagnostics);
          if (index === 1 && "bundles" in result.value) {
            const loadedBundles = result.value.bundles;
            setPersonalBundles((current) => {
              const merged = new Map<string, ArtifactBundle>(
                loadedBundles.map((bundle) => [bundle.artifactId, bundle]),
              );
              current.forEach((bundle) => merged.set(bundle.artifactId, bundle));
              return [...merged.values()];
            });
          }
        } else {
          diagnostics.push(result.reason instanceof Error ? result.reason.message : "Artifact source failed to load");
        }
      });
      setRegistry((current) => ({ ...nextRegistry, ...current }));
      setDiagnostics(diagnostics);
    });

    return () => {
      cancelled = true;
    };
  }, [builtInRegistry]);

  return { diagnostics, personalBundles, registry, setPersonalBundles, setRegistry };
}
