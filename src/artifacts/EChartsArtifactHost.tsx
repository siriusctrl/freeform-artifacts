import { useEffect, useMemo, useRef, useState } from "react";
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
  const [size, setSize] = useState(renderProps.size);
  const [lifecycleError, setLifecycleError] = useState<Error | null>(null);
  if (lifecycleError) throw lifecycleError;
  const option = useMemo<EChartsOption>(
    () => artifact.buildOption({ ...renderProps, size }),
    [artifact, renderProps.data, renderProps.config, renderProps.theme, size],
  );

  useEffect(() => {
    const element = chartEl.current;
    if (!element) {
      return;
    }
    const chartElement = element;

    try {
      chart.current = echarts.init(chartElement, null, {
        renderer: artifact.chartRenderer ?? "svg",
      });
    } catch (error) {
      setLifecycleError(error instanceof Error ? error : new Error("Unable to initialize chart"));
      return;
    }

    function syncSize() {
      const width = Math.round(chartElement.clientWidth);
      const height = Math.round(chartElement.clientHeight);
      try {
        chart.current?.resize({ width, height });
      } catch (error) {
        setLifecycleError(error instanceof Error ? error : new Error("Unable to resize chart"));
      }
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    }

    const observer = new ResizeObserver(syncSize);
    observer.observe(chartElement);
    syncSize();

    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [artifact]);

  useEffect(() => {
    try {
      chart.current?.setOption(option, true);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error : new Error("Unable to update chart"));
    }
  }, [option]);

  return (
    <div
      ref={chartEl}
      className={`echarts-host ${artifact.interactive ? "interactive" : ""}`}
      data-testid={`echarts-${artifact.id}`}
    />
  );
}
