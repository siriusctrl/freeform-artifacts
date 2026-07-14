import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import { CANVAS_GRID_SIZE } from "../lib/geometry";

export type LayoutAction =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizedSelectionRect(first: { x: number; y: number }, second: { x: number; y: number }): SelectionRect {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

export function nodesIntersectingRect(nodes: CanvasNode[], rect: SelectionRect) {
  return nodes
    .filter((node) => (
      node.x < rect.x + rect.width &&
      node.x + node.width > rect.x &&
      node.y < rect.y + rect.height &&
      node.y + node.height > rect.y
    ))
    .map((node) => node.id);
}

export function selectedBounds(nodes: CanvasNode[], selectedNodeIds: string[]) {
  const selected = nodes.filter((node) => selectedNodeIds.includes(node.id));
  if (selected.length === 0) return null;
  const left = Math.min(...selected.map((node) => node.x));
  const top = Math.min(...selected.map((node) => node.y));
  const right = Math.max(...selected.map((node) => node.x + node.width));
  const bottom = Math.max(...selected.map((node) => node.y + node.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function bringSelectionToFront(nodes: CanvasNode[], selectedNodeIds: string[]) {
  const selectedIds = new Set(selectedNodeIds);
  const selected = nodes
    .filter((node) => selectedIds.has(node.id))
    .sort((first, second) => first.zIndex - second.zIndex);
  if (selected.length === 0) return nodes;
  const maxZ = Math.max(0, ...nodes.map((node) => node.zIndex));
  const nextZ = new Map(selected.map((node, index) => [node.id, maxZ + index + 1]));
  return nodes.map((node) => nextZ.has(node.id) ? { ...node, zIndex: nextZ.get(node.id)! } : node);
}

function distribute(selected: CanvasNode[], axis: "x" | "y") {
  const size = axis === "x" ? "width" : "height";
  const sorted = [...selected].sort((first, second) => first[axis] - second[axis]);
  if (sorted.length < 3) return new Map<string, number>();
  const start = sorted[0][axis];
  const last = sorted.at(-1)!;
  const end = last[axis] + last[size];
  const occupied = sorted.reduce((total, node) => total + node[size], 0);
  const gap = (end - start - occupied) / (sorted.length - 1);
  let cursor = start;
  return new Map(sorted.map((node, index) => {
    const position = index === sorted.length - 1 ? last[axis] : Math.round(cursor);
    cursor += node[size] + gap;
    return [node.id, position];
  }));
}

export function layoutSelection(nodes: CanvasNode[], selectedNodeIds: string[], action: LayoutAction) {
  const selectedIds = new Set(selectedNodeIds);
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) return nodes;
  const bounds = selectedBounds(nodes, selectedNodeIds)!;
  const distributed = action === "distribute-horizontal"
    ? distribute(selected, "x")
    : action === "distribute-vertical"
      ? distribute(selected, "y")
      : null;

  return nodes.map((node) => {
    if (!selectedIds.has(node.id)) return node;
    switch (action) {
      case "align-left": return { ...node, x: bounds.left };
      case "align-center": return { ...node, x: Math.round(bounds.left + (bounds.width - node.width) / 2) };
      case "align-right": return { ...node, x: bounds.right - node.width };
      case "align-top": return { ...node, y: bounds.top };
      case "align-middle": return { ...node, y: Math.round(bounds.top + (bounds.height - node.height) / 2) };
      case "align-bottom": return { ...node, y: bounds.bottom - node.height };
      case "distribute-horizontal": return distributed?.has(node.id) ? { ...node, x: distributed.get(node.id)! } : node;
      case "distribute-vertical": return distributed?.has(node.id) ? { ...node, y: distributed.get(node.id)! } : node;
    }
  });
}

export function cloneCanvasNodes(sourceNodes: CanvasNode[], targetNodes: CanvasNode[], offset = CANVAS_GRID_SIZE) {
  let zIndex = Math.max(0, ...targetNodes.map((node) => node.zIndex));
  return sourceNodes.map((node) => ({
    ...node,
    id: `node-${node.artifactId}-${crypto.randomUUID().slice(0, 8)}`,
    x: node.x + offset,
    y: node.y + offset,
    zIndex: zIndex += 1,
    data: structuredClone(node.data),
    config: structuredClone(node.config),
    dataBinding: node.dataBinding ? structuredClone(node.dataBinding) : undefined,
  }));
}

export function cloneSelectedNodes(nodes: CanvasNode[], selectedNodeIds: string[], offset = CANVAS_GRID_SIZE) {
  const selectedIds = new Set(selectedNodeIds);
  const selected = nodes
    .filter((node) => selectedIds.has(node.id))
    .sort((first, second) => first.zIndex - second.zIndex);
  return cloneCanvasNodes(selected, nodes, offset);
}

export function fitNodesToViewport(
  nodes: CanvasNode[],
  stageSize: { width: number; height: number },
  padding = 56,
): CanvasViewport {
  const bounds = selectedBounds(nodes, nodes.map((node) => node.id));
  if (!bounds) return { x: stageSize.width / 2, y: stageSize.height / 2, scale: 1 };
  const availableWidth = Math.max(1, stageSize.width - padding * 2);
  const availableHeight = Math.max(1, stageSize.height - padding * 2);
  const scale = Math.min(1.2, Math.max(0.08, Math.min(availableWidth / bounds.width, availableHeight / bounds.height)));
  return {
    scale,
    x: (stageSize.width - bounds.width * scale) / 2 - bounds.left * scale,
    y: (stageSize.height - bounds.height * scale) / 2 - bounds.top * scale,
  };
}
