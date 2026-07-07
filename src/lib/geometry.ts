import type { CanvasViewport } from "../artifacts/types";

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.4;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(point: { x: number; y: number }, viewport: CanvasViewport) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
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
