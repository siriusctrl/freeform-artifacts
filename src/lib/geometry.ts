import type { CanvasViewport } from "../artifacts/types";

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.4;
export const CANVAS_GRID_SIZE = 38;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(point: { x: number; y: number }, viewport: CanvasViewport) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function clientToStage(
  point: { x: number; y: number },
  stageRect: Pick<DOMRect, "left" | "top">,
) {
  return {
    x: point.x - stageRect.left,
    y: point.y - stageRect.top,
  };
}

export function zoomAt(
  viewport: CanvasViewport,
  screenPoint: { x: number; y: number },
  nextScale: number,
): CanvasViewport {
  const scale = clampScale(nextScale);
  const worldPoint = screenToWorld(screenPoint, viewport);

  return {
    scale,
    x: screenPoint.x - worldPoint.x * scale,
    y: screenPoint.y - worldPoint.y * scale,
  };
}

export function snapToGrid(value: number, gridSize = CANVAS_GRID_SIZE) {
  return Math.round(value / gridSize) * gridSize;
}
