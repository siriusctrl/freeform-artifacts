import type { RegisteredArtifact } from "./registryTypes";

function isPositiveSize(value: unknown): value is { width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const size = value as { width?: unknown; height?: unknown };
  return (
    typeof size.width === "number" &&
    Number.isFinite(size.width) &&
    size.width > 0 &&
    typeof size.height === "number" &&
    Number.isFinite(size.height) &&
    size.height > 0
  );
}

export function assertArtifactDefinition(
  value: unknown,
  expectedId?: string,
): asserts value is RegisteredArtifact {
  if (!value || typeof value !== "object") {
    throw new Error("Artifact module must export an object");
  }

  const artifact = value as Partial<RegisteredArtifact>;
  if (typeof artifact.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifact.id)) {
    throw new Error("Artifact id must use lowercase kebab-case");
  }
  if (expectedId && artifact.id !== expectedId) {
    throw new Error(`Bundle must export artifact ${expectedId}`);
  }
  if (typeof artifact.title !== "string" || !artifact.title.trim()) {
    throw new Error(`Artifact ${artifact.id} must declare a title`);
  }
  if (typeof artifact.version !== "string" || !artifact.version.trim()) {
    throw new Error(`Artifact ${artifact.id} must declare a version`);
  }
  if (!isPositiveSize(artifact.defaultSize)) {
    throw new Error(`Artifact ${artifact.id} must declare a positive defaultSize`);
  }
  if (artifact.minSize !== undefined && !isPositiveSize(artifact.minSize)) {
    throw new Error(`Artifact ${artifact.id} minSize must be positive`);
  }

  if (artifact.renderer === "echarts") {
    if (typeof artifact.buildOption !== "function") {
      throw new Error(`ECharts artifact ${artifact.id} must define buildOption`);
    }
    if (artifact.chartRenderer !== undefined && !["svg", "canvas"].includes(artifact.chartRenderer)) {
      throw new Error(`Artifact ${artifact.id} has an unsupported chartRenderer`);
    }
    return;
  }

  if (artifact.renderer !== undefined && artifact.renderer !== "react") {
    throw new Error(`Artifact ${artifact.id} has an unsupported renderer`);
  }
  if (typeof (artifact as { render?: unknown }).render !== "function") {
    throw new Error(`React artifact ${artifact.id} must define render`);
  }
}
