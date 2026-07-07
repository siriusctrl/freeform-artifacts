import type { CanvasNode } from "../artifacts/types";

export function createMetricNode(index: number, position: { x: number; y: number }): CanvasNode {
  return {
    id: `node-ai-${Date.now()}`,
    artifactId: "metric-card",
    title: "AI Generated Metric",
    x: Math.round(position.x + index * 18),
    y: Math.round(position.y + index * 14),
    width: 280,
    height: 170,
    zIndex: 10 + index,
    data: {
      label: "AI generated card",
      value: 224_800 + index * 4_200,
      delta: 0.12,
      caption: "Created from registry contract",
    },
    config: {},
  };
}
