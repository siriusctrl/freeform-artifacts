import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { ArtifactRenderProps, ChartKitArtifactDefinition, EChartsArtifactDefinition } from "./types";
import { buildChartKitOption } from "./chartKit";
import { EChartsArtifactHost } from "./EChartsArtifactHost";

interface ChartKitArtifactHostProps {
  artifact: ChartKitArtifactDefinition<any, any>;
  renderProps: ArtifactRenderProps<any, any>;
}

export function ChartKitArtifactHost({ artifact, renderProps }: ChartKitArtifactHostProps) {
  const managedArtifact = useMemo<EChartsArtifactDefinition<any, any>>(
    () => ({
      id: artifact.id,
      renderer: "echarts",
      chartRenderer: "svg",
      title: artifact.title,
      version: artifact.version,
      defaultSize: artifact.defaultSize,
      minSize: artifact.minSize,
      dataValidator: artifact.dataValidator,
      configValidator: artifact.configValidator,
      buildOption: (props) => buildChartKitOption(artifact.buildChart(props), props) as EChartsOption,
    }),
    [artifact],
  );

  return <EChartsArtifactHost artifact={managedArtifact} renderProps={renderProps} />;
}
