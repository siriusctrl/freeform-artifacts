import type { EChartsArtifactDefinition } from "./types";
import { inflectionProbabilityDataSchema, type InflectionProbabilityData } from "./schemas";

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
  dataSchema: {
    type: "object",
    required: ["title", "note", "points", "markers"],
  },
  dataValidator: inflectionProbabilityDataSchema,
  buildOption: ({ data, theme }) => {
    const isDark = theme.mode === "dark";
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const grid = isDark ? "rgba(238,243,243,0.26)" : "rgba(23,23,23,0.22)";
    const panel = isDark ? "rgba(53,200,220,0.09)" : "rgba(0,152,184,0.08)";
    const alert = isDark ? "#ff6b70" : "#ef4444";

    return {
      backgroundColor: "transparent",
      animationDuration: 500,
      title: {
        text: data.title,
        left: 24,
        top: 18,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: 24,
          fontWeight: 780,
        },
      },
      graphic: [
        {
          type: "rect",
          left: 24,
          top: 62,
          shape: { width: 666, height: 76, r: 8 },
          style: {
            fill: panel,
            stroke: isDark ? "rgba(53,200,220,0.25)" : "rgba(0,152,184,0.24)",
            lineWidth: 1,
          },
        },
        {
          type: "text",
          left: 42,
          top: 78,
          style: {
            text: `{b|What:} ${data.note.what}\n{b|Read:} ${data.note.read}\n{b|Logic:} ${data.note.logic}`,
            rich: {
              b: { fill: text, fontWeight: 760 },
            },
            fill: muted,
            font: "12px Geist Variable",
            lineHeight: 19,
          },
        },
        {
          type: "text",
          right: 28,
          bottom: 16,
          style: {
            text: `P25: ${data.markers.p25}     P50: ${data.markers.p50}     P75: ${data.markers.p75}`,
            fill: text,
            font: "700 15px Geist Mono Variable",
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => pct(Number(value)),
      },
      legend: {
        top: 150,
        left: "center",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: 13,
        },
      },
      grid: {
        left: 58,
        right: 38,
        top: 192,
        bottom: 58,
      },
      xAxis: {
        type: "category",
        data: data.points.map((point) => point.quarter),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: grid } },
        axisLabel: {
          color: muted,
          interval: 1,
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
