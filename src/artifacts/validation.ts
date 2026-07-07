import type { CanvasNode } from "./types";
import type { RegisteredArtifact } from "./registryTypes";

export interface ArtifactValidationResult {
  ok: boolean;
  message?: string;
}

export function validateArtifactPayload(
  node: CanvasNode,
  artifact: RegisteredArtifact | undefined,
): ArtifactValidationResult {
  if (!artifact) {
    return { ok: false, message: `Unknown artifact: ${node.artifactId}` };
  }

  if (artifact.dataValidator) {
    const result = artifact.dataValidator.safeParse(node.data);
    if (!result.success) {
      return {
        ok: false,
        message: result.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", "),
      };
    }
  }

  if (artifact.configValidator) {
    const result = artifact.configValidator.safeParse(node.config);
    if (!result.success) {
      return {
        ok: false,
        message: result.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", "),
      };
    }
  }

  return { ok: true };
}
