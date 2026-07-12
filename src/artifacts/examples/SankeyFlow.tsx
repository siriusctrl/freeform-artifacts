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
    const visualScale = Math.max(0.82, Math.min(1.5, Math.min(size.width / 600, size.height / 328)));
    const scaled = (value: number) => Math.round(value * visualScale);
    const horizontalPadding = scaled(22);
    const rightLabelSpace = scaled(94);
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
        top: scaled(20),
        itemGap: scaled(8),
        textStyle: {
          color: text,
          fontFamily: "Geist Variable",
          fontSize: scaled(22),
          fontWeight: 800,
          width: size.width - horizontalPadding * 2,
          overflow: "truncate",
        },
        subtextStyle: {
          color: muted,
          fontFamily: "Geist Variable",
          fontSize: scaled(12),
          lineHeight: scaled(17),
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
          top: scaled(92),
          left: horizontalPadding,
          right: rightLabelSpace,
          bottom: scaled(20),
          nodeGap: scaled(14),
          nodeWidth: scaled(18),
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
            fontSize: scaled(12),
            fontWeight: 680,
          },
          data: data.nodes,
          links: data.links,
        },
      ],
    };
  },
};
