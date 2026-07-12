import type { EChartsArtifactDefinition } from "../types";
import { sankeyFlowDataSchema, type SankeyFlowData } from "../schemas";

export const sankeyFlowArtifact: EChartsArtifactDefinition<SankeyFlowData> = {
  id: "sankey-flow",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Sankey Flow",
  version: "0.1.0",
  defaultSize: { width: 600, height: 360 },
  minSize: { width: 532, height: 342 },
  dataSchema: {
    type: "object",
    required: ["title", "subtitle", "nodes", "links"],
  },
  dataValidator: sankeyFlowDataSchema,
  buildOption: ({ data, size, theme }) => {
    const isDark = theme.mode === "dark";
    const horizontalPadding = 24;
    const rightLabelSpace = 76;
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const border = isDark ? "rgba(238,243,243,0.16)" : "rgba(23,23,23,0.12)";
    const tooltipBackground = isDark ? "#202628" : "#ffffff";
    const palette = isDark
      ? ["#22d3ee", "#2dd4bf", "#facc15", "#60a5fa", "#fb7185", "#a8a29e"]
      : ["#0891b2", "#0f766e", "#ca8a04", "#2563eb", "#dc5a5f", "#78716c"];

    return {
      backgroundColor: "transparent",
      animation: false,
      title: {
        text: data.title,
        subtext: data.subtitle,
        left: horizontalPadding,
        top: 18,
        itemGap: 7,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: 23,
          fontWeight: 780,
          width: size.width - horizontalPadding * 2,
          overflow: "truncate",
        },
        subtextStyle: {
          color: muted,
          fontFamily: "Geist Variable",
          fontSize: 12,
          lineHeight: 17,
          width: Math.max(220, size.width - horizontalPadding * 2),
          overflow: "break",
        },
      },
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        backgroundColor: tooltipBackground,
        borderColor: border,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
        },
      },
      series: [
        {
          type: "sankey",
          top: 96,
          left: horizontalPadding,
          right: rightLabelSpace,
          bottom: 24,
          nodeGap: 18,
          nodeWidth: 12,
          nodeAlign: "justify",
          layoutIterations: 24,
          draggable: false,
          emphasis: {
            focus: "adjacency",
            lineStyle: {
              opacity: 0.72,
            },
          },
          lineStyle: {
            color: "gradient",
            curveness: 0.5,
            opacity: isDark ? 0.3 : 0.36,
          },
          itemStyle: {
            borderColor: border,
            borderWidth: 0,
          },
          label: {
            color: text,
            fontFamily: "Geist Variable",
            fontSize: 12,
            fontWeight: 650,
            distance: 8,
          },
          data: data.nodes.map((node, index) => ({
            ...node,
            itemStyle: {
              color: palette[index % palette.length],
            },
          })),
          links: data.links,
        },
      ],
    };
  },
};
