import type { EChartsArtifactDefinition } from "../types";
import { inflectionProbabilityDataSchema, type InflectionProbabilityData } from "../schemas";

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export const inflectionProbabilityArtifact: EChartsArtifactDefinition<InflectionProbabilityData> = {
  id: "inflection-probability",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Inflection Probability",
  version: "0.1.0",
  defaultSize: { width: 720, height: 460 },
  minSize: { width: 570, height: 418 },
  dataSchema: {
    type: "object",
    required: ["title", "note", "points", "markers"],
  },
  dataValidator: inflectionProbabilityDataSchema,
  buildOption: ({ data, size, theme }) => {
    const isDark = theme.mode === "dark";
    const compact = size.width < 640 || size.height < 400;
    const horizontalPadding = compact ? 18 : 24;
    const titleTop = compact ? 14 : 18;
    const titleFontSize = compact ? 20 : 24;
    const noteTop = compact ? 52 : 62;
    const noteHeight = compact ? 90 : 76;
    const noteWidth = Math.max(240, size.width - horizontalPadding * 2);
    const legendTop = noteTop + noteHeight + 12;
    const plotTop = legendTop + 38;
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const grid = isDark ? "rgba(238,243,243,0.26)" : "rgba(23,23,23,0.22)";
    const panel = isDark ? "rgba(53,200,220,0.09)" : "rgba(0,152,184,0.08)";
    const alert = isDark ? "#ff6b70" : "#ef4444";
    const tooltipBackground = isDark ? "#202628" : "#ffffff";
    const noteLines = [
      ["What", data.note.what],
      ["Read", data.note.read],
      ["Logic", data.note.logic],
    ];

    return {
      backgroundColor: "transparent",
      animation: false,
      title: {
        text: data.title,
        left: horizontalPadding,
        top: titleTop,
        textStyle: {
          color: text,
          fontFamily: "Instrument Sans Variable",
          fontSize: titleFontSize,
          fontWeight: 650,
          width: noteWidth,
          overflow: "truncate",
        },
      },
      graphic: [
        {
          type: "rect",
          left: horizontalPadding,
          top: noteTop,
          shape: { width: noteWidth, height: noteHeight, r: 8 },
          style: {
            fill: panel,
            stroke: isDark ? "rgba(53,200,220,0.25)" : "rgba(0,152,184,0.24)",
            lineWidth: 1,
          },
        },
        ...noteLines.map(([label, value], index) => ({
          type: "text" as const,
          left: horizontalPadding + 18,
          top: noteTop + 14 + index * 20,
          style: {
            text: `{b|${label}:} ${value}`,
            rich: {
              b: { fill: text, fontWeight: 620 },
            },
            fill: muted,
            font: '12px "Instrument Sans Variable"',
          },
        })),
        {
          type: "text",
          left: "center",
          bottom: compact ? 12 : 16,
          style: {
            text: `P25: ${data.markers.p25}     P50: ${data.markers.p50}     P75: ${data.markers.p75}`,
            align: "center",
            fill: text,
            font: `700 ${compact ? 13 : 15}px Geist Mono Variable`,
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => pct(Number(value)),
        backgroundColor: tooltipBackground,
        borderColor: grid,
        textStyle: {
          color: text,
          fontFamily: "Instrument Sans Variable",
        },
      },
      legend: {
        top: legendTop,
        left: "center",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          color: text,
          fontFamily: "Instrument Sans Variable",
          fontSize: 13,
        },
      },
      grid: {
        left: compact ? 52 : 58,
        right: compact ? 30 : 38,
        top: plotTop,
        bottom: compact ? 56 : 62,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: data.points.map((point) => point.quarter),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: grid } },
        axisLabel: {
          color: muted,
          interval: 1,
          alignMinLabel: "left",
          alignMaxLabel: "right",
          fontFamily: "Geist Mono Variable",
          fontSize: 10,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 1,
        interval: 0.25,
        axisLabel: {
          color: muted,
          formatter: (value: number) => `${Math.round(value * 100)}%`,
          fontFamily: "Geist Mono Variable",
          fontSize: 11,
        },
        splitLine: {
          lineStyle: {
            color: grid,
            width: 1,
          },
        },
      },
      series: [
        {
          name: "P(inflection at T)",
          type: "bar",
          data: data.points.map((point) => point.probabilityAt),
          barWidth: 20,
          itemStyle: {
            color: isDark ? "rgba(255,107,112,0.58)" : "rgba(239,68,68,0.48)",
            borderRadius: [4, 4, 0, 0],
          },
        },
        {
          name: "P(inflection by T)",
          type: "line",
          data: data.points.map((point) => point.probabilityBy),
          smooth: 0.35,
          symbolSize: 7,
          lineStyle: {
            color: alert,
            width: 3,
          },
          itemStyle: {
            color: alert,
          },
          markLine: {
            symbol: "none",
            label: {
              formatter: "P50",
              color: muted,
            },
            lineStyle: {
              color: grid,
              type: "dashed",
            },
            data: [{ yAxis: 0.5 }],
          },
        },
      ],
    };
  },
};
