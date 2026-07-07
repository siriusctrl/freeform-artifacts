import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, SankeyChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import type { EChartsOption, EChartsType } from "echarts";
import type { ArtifactRenderProps, EChartsArtifactDefinition } from "./types";

echarts.use([
  BarChart,
  LineChart,
  SankeyChart,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  LabelLayout,
  SVGRenderer,
  CanvasRenderer,
]);

interface EChartsArtifactHostProps {
  artifact: EChartsArtifactDefinition<any, any>;
  renderProps: ArtifactRenderProps<any, any>;
}

export function EChartsArtifactHost({ artifact, renderProps }: EChartsArtifactHostProps) {
  const chartEl = useRef<HTMLDivElement | null>(null);
  const chart = useRef<EChartsType | null>(null);
  const option = useMemo<EChartsOption>(
    () => artifact.buildOption(renderProps),
    [artifact, renderProps.data, renderProps.config, renderProps.theme],
  );

  useEffect(() => {
    const element = chartEl.current;
    if (!element) {
      return;
    }

    chart.current = echarts.init(element, null, {
      renderer: artifact.chartRenderer ?? "svg",
    });

    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [artifact]);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={chartEl}
      className={`echarts-host ${artifact.interactive ? "interactive" : ""}`}
      data-testid={`echarts-${artifact.id}`}
    />
  );
}
