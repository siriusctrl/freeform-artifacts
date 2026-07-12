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
    const compact = size.width < 560 || size.height < 320;
    const horizontalPadding = compact ? 18 : 22;
    const rightLabelSpace = compact ? 78 : 94;
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const nodeFill = isDark ? "#202628" : "#f5f7f7";
    const border = isDark ? "rgba(238,243,243,0.16)" : "rgba(23,23,23,0.12)";

    return {
      backgroundColor: "transparent",
      animation: false,
      title: {
        text: data.title,
        subtext: data.subtitle,
        left: horizontalPadding,
        top: compact ? 16 : 20,
        itemGap: 8,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: compact ? 19 : 22,
          fontWeight: 800,
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
      },
      series: [
        {
          type: "sankey",
          top: compact ? 98 : 92,
          left: horizontalPadding,
          right: rightLabelSpace,
          bottom: compact ? 16 : 20,
          nodeGap: 14,
          nodeWidth: 18,
          draggable: false,
          emphasis: {
            focus: "adjacency",
          },
          lineStyle: {
            color: "gradient",
            curveness: 0.55,
            opacity: 0.42,
          },
          itemStyle: {
            color: nodeFill,
            borderColor: border,
            borderWidth: 1,
          },
          label: {
            color: text,
            fontFamily: "Geist Variable",
            fontSize: 12,
            fontWeight: 680,
          },
          data: data.nodes,
          links: data.links,
        },
      ],
    };
  },
};
