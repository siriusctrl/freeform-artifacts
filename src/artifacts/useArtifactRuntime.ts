import { useEffect, useState } from "react";
import { loadInstalledArtifactRegistry } from "./generated/bundles";
import { loadExternalArtifactRegistry } from "./generated/externalLoader";
import type { RegisteredArtifact } from "./registryTypes";

export function useArtifactRuntime(
  builtInRegistry: Record<string, RegisteredArtifact>,
) {
  const [registry, setRegistry] = useState<Record<string, RegisteredArtifact>>(builtInRegistry);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadExternalArtifactRegistry(), loadInstalledArtifactRegistry()]).then((results) => {
      if (cancelled) return;
      const nextRegistry = { ...builtInRegistry };
      const diagnostics: string[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          Object.assign(nextRegistry, result.value.registry);
          diagnostics.push(...result.value.diagnostics);
        } else {
          diagnostics.push(result.reason instanceof Error ? result.reason.message : "Artifact source failed to load");
        }
      }
      setRegistry(nextRegistry);
      setDiagnostics(diagnostics);
    });

    return () => {
      cancelled = true;
    };
  }, [builtInRegistry]);

  return { diagnostics, registry, setRegistry };
}
