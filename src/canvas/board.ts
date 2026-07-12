import { z } from "zod";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import type { ThemeMode } from "./constants";

const LEGACY_BOARD_STORAGE_KEY = "freeform-artifacts.board.v1";
export const BOARD_VERSION = 1;

export const canvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().min(0.25).max(2.5),
});

export const canvasNodeSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().min(120),
  height: z.number().min(100),
  zIndex: z.number(),
  dataBinding: z
    .object({
      sourceId: z.string(),
      transformId: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  data: z.unknown(),
  config: z.record(z.string(), z.unknown()),
});

export const boardStateSchema = z.object({
  version: z.literal(BOARD_VERSION),
  nodes: z.array(canvasNodeSchema),
  viewport: canvasViewportSchema,
  selectedNodeId: z.string(),
  themeMode: z.enum(["light", "dark"]),
  snapToGrid: z.boolean().default(true),
});

export interface BoardState {
  version: typeof BOARD_VERSION;
  nodes: CanvasNode[];
  viewport: CanvasViewport;
  selectedNodeId: string;
  themeMode: ThemeMode;
  snapToGrid: boolean;
}

export function createBoardState(state: Omit<BoardState, "version">): BoardState {
  return {
    version: BOARD_VERSION,
    ...state,
  };
}

export function loadLegacyBoardState(): BoardState | null {
  const raw = window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = boardStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearLegacyBoardState() {
  window.localStorage.removeItem(LEGACY_BOARD_STORAGE_KEY);
}
