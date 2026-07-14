import { assertSupportedRawEChartsOption, buildChartKitOption } from "../chartKit";
import type { RegisteredArtifact } from "../registryTypes";
import type { CanvasNode } from "../types";
import { validateArtifactPayload } from "../validation";
import { themeFor } from "../../canvas/constants";

export function validatePreparedArtifact(node: CanvasNode, artifact: RegisteredArtifact) {
  const validation = validateArtifactPayload(node, artifact);
  if (!validation.ok) throw new Error(validation.message);
  const sizes = [artifact.defaultSize, artifact.minSize ?? artifact.defaultSize];
  let renderChecks = 0;
  for (const mode of ["light", "dark"] as const) {
    for (const size of sizes) {
      const props = { data: node.data, config: node.config, size, theme: themeFor(mode) };
      if (artifact.renderer === "chart-kit") {
        buildChartKitOption(artifact.buildChart(props), props);
        renderChecks += 1;
      } else if (artifact.renderer === "echarts") {
        assertSupportedRawEChartsOption(artifact.buildOption(props));
        renderChecks += 1;
      }
    }
  }
  return renderChecks;
}
