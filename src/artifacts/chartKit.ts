import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type {
  AriaComponentOption,
  DatasetComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  TitleComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type {
  ArtifactRenderProps,
  ChartKitCartesianSeries,
  ChartKitSpec,
  ChartKitValueFormat,
} from "./types";

export const CHART_KIT_CAPABILITIES = {
  version: 1,
  kinds: ["cartesian"],
  series: ["bar", "line"],
  rawEChartsSeries: ["bar", "line", "sankey"],
} as const;

type ChartKitOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | AriaComponentOption
  | DatasetComponentOption
  | GridComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | TitleComponentOption
  | TooltipComponentOption
>;

const LIGHT_PALETTE = ["#0098b8", "#dc5a5f", "#0f766e", "#ca8a04", "#2563eb", "#7c3aed"];
const DARK_PALETTE = ["#35c8dc", "#ff7478", "#2dd4bf", "#facc15", "#60a5fa", "#a78bfa"];

function assertChartKitSpec(spec: ChartKitSpec) {
  if (spec.kind !== "cartesian") throw new Error(`Unsupported Chart Kit kind: ${(spec as { kind?: unknown }).kind}`);
  if (!spec.categories.length) throw new Error("Chart Kit cartesian charts require categories");
  if (!spec.series.length) throw new Error("Chart Kit cartesian charts require at least one series");
  const ids = new Set<string>();
  for (const series of spec.series) {
    if (!series.id || ids.has(series.id)) throw new Error("Chart Kit series ids must be non-empty and unique");
    ids.add(series.id);
    if (!CHART_KIT_CAPABILITIES.series.includes(series.type)) {
      throw new Error(`Unsupported Chart Kit series: ${series.type}`);
    }
    if (series.values.length !== spec.categories.length) {
      throw new Error(`Chart Kit series ${series.id} must match the category count`);
    }
    if (series.values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Chart Kit series ${series.id} contains a non-finite value`);
    }
  }
}

function createValueFormatter(format: ChartKitValueFormat, currency = "USD") {
  const formatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    ...(format === "currency" ? { style: "currency", currency } : {}),
  });
  return (value: unknown) => {
    const number = Number(value);
    if (format === "percent") return `${Math.round(number * 100)}%`;
    return Number.isFinite(number) ? formatter.format(number) : String(value ?? "");
  };
}

function createSeries(
  series: ChartKitCartesianSeries,
  index: number,
  color: string,
  referenceLines: ChartKitSpec["referenceLines"],
  text: string,
  line: string,
): BarSeriesOption | LineSeriesOption {
  const markLine = index === 0 && referenceLines?.length
    ? {
        silent: true,
        symbol: "none" as const,
        lineStyle: { color: line, type: "dashed" as const, width: 1 },
        label: { color: text, fontFamily: "Instrument Sans Variable", fontSize: 11 },
        data: referenceLines.map((marker) => ({ yAxis: marker.value, name: marker.label })),
      }
    : undefined;

  if (series.type === "bar") {
    return {
      id: series.id,
      name: series.name,
      type: "bar",
      stack: series.stack,
      encode: { x: "category", y: series.id, itemName: "category" },
      itemStyle: { color, borderRadius: [4, 4, 0, 0] },
      emphasis: { itemStyle: { opacity: 0.84 } },
      barMaxWidth: 42,
      markLine,
    };
  }

  return {
    id: series.id,
    name: series.name,
    type: "line",
    stack: series.stack,
    encode: { x: "category", y: series.id, itemName: "category" },
    smooth: series.smooth ?? true,
    showSymbol: true,
    symbolSize: 6,
    lineStyle: { color, width: 2.5 },
    itemStyle: { color },
    areaStyle: series.area ? { color, opacity: 0.12 } : undefined,
    emphasis: { focus: "series" },
    markLine,
  };
}

export function buildChartKitOption(
  spec: ChartKitSpec,
  { size, theme }: Pick<ArtifactRenderProps, "size" | "theme">,
): ChartKitOption {
  assertChartKitSpec(spec);
  const isDark = theme.mode === "dark";
  const text = theme.text;
  const muted = isDark ? "#a4afb1" : "#667174";
  const line = isDark ? "rgba(238,243,243,0.18)" : "rgba(23,23,23,0.14)";
  const tooltipSurface = isDark ? "#202628" : "#ffffff";
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  const format = spec.valueFormat ?? "number";
  const valueFormatter = createValueFormatter(format, spec.currency);
  const hasTitle = Boolean(spec.title || spec.subtitle);
  const showLegend = spec.legend ?? spec.series.length > 1;
  const titleHeight = hasTitle ? (spec.subtitle ? 68 : 48) : 0;
  const legendHeight = showLegend ? 34 : 0;
  const plotTop = 20 + titleHeight + legendHeight;
  const horizontalPadding = size.width < 520 ? 16 : 24;
  const datasetSource = [
    ["category", ...spec.series.map((series) => series.id)],
    ...spec.categories.map((category, index) => [category, ...spec.series.map((series) => series.values[index])]),
  ];

  return {
    backgroundColor: "transparent",
    animation: false,
    aria: { enabled: true },
    color: palette,
    dataset: { source: datasetSource },
    title: hasTitle
      ? {
          text: spec.title,
          subtext: spec.subtitle,
          left: horizontalPadding,
          top: 16,
          itemGap: 6,
          textStyle: {
            color: text,
            fontFamily: "Instrument Sans Variable",
            fontSize: size.width < 520 ? 18 : 22,
            fontWeight: 650,
            width: size.width - horizontalPadding * 2,
            overflow: "truncate",
          },
          subtextStyle: {
            color: muted,
            fontFamily: "Instrument Sans Variable",
            fontSize: 12,
            width: size.width - horizontalPadding * 2,
            overflow: "truncate",
          },
        }
      : undefined,
    legend: showLegend
      ? {
          top: 18 + titleHeight,
          left: horizontalPadding,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: muted, fontFamily: "Instrument Sans Variable", fontSize: 12 },
        }
      : undefined,
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipSurface,
      borderColor: line,
      textStyle: { color: text, fontFamily: "Instrument Sans Variable" },
      valueFormatter,
    },
    grid: {
      left: horizontalPadding,
      right: horizontalPadding,
      top: plotTop,
      bottom: 28,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      axisTick: { show: false },
      axisLine: { lineStyle: { color: line } },
      axisLabel: { color: muted, fontFamily: "Geist Mono Variable", fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted, fontFamily: "Geist Mono Variable", fontSize: 11, formatter: valueFormatter },
      splitLine: { lineStyle: { color: line } },
    },
    series: spec.series.map((series, index) => createSeries(
      series,
      index,
      series.color ?? palette[index % palette.length],
      spec.referenceLines,
      muted,
      line,
    )),
  };
}

export function assertSupportedRawEChartsOption(option: unknown) {
  if (!option || typeof option !== "object") throw new Error("ECharts buildOption must return an option object");
  const series = (option as { series?: unknown }).series;
  const entries = Array.isArray(series) ? series : series ? [series] : [];
  for (const entry of entries) {
    const type = entry && typeof entry === "object" ? (entry as { type?: unknown }).type : undefined;
    if (typeof type === "string" && !CHART_KIT_CAPABILITIES.rawEChartsSeries.includes(type as "bar" | "line" | "sankey")) {
      throw new Error(`Raw ECharts series ${type} is not registered by this host`);
    }
  }
}
