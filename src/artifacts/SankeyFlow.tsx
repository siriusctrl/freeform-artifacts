import type { EChartsArtifactDefinition } from "./types";
import { sankeyFlowDataSchema, type SankeyFlowData } from "./schemas";

export const sankeyFlowArtifact: EChartsArtifactDefinition<SankeyFlowData> = {
  id: "sankey-flow",
  renderer: "echarts",
  chartRenderer: "svg",
  title: "Sankey Flow",
  version: "0.1.0",
  defaultSize: { width: 600, height: 360 },
  dataSchema: {
    type: "object",
    required: ["title", "subtitle", "nodes", "links"],
  },
  dataValidator: sankeyFlowDataSchema,
  buildOption: ({ data, theme }) => {
    const isDark = theme.mode === "dark";
    const text = isDark ? "#eef3f3" : "#171717";
    const muted = isDark ? "#a4afb1" : "#667174";
    const nodeFill = isDark ? "#202628" : "#f5f7f7";
    const border = isDark ? "rgba(238,243,243,0.16)" : "rgba(23,23,23,0.12)";

    return {
      backgroundColor: "transparent",
      animationDuration: 600,
      title: {
        text: data.title,
        subtext: data.subtitle,
        left: 22,
        top: 20,
        itemGap: 8,
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: 22,
          fontWeight: 800,
        },
        subtextStyle: {
          color: muted,
          fontFamily: "Geist Variable",
          fontSize: 12,
          lineHeight: 17,
          width: 250,
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
          top: 92,
          left: 22,
          right: 22,
          bottom: 20,
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
