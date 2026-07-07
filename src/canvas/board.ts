import { z } from "zod";
import type { CanvasNode, CanvasViewport } from "../artifacts/types";
import type { ThemeMode } from "./constants";

const BOARD_STORAGE_KEY = "freeform-artifacts.board.v1";
const BOARD_VERSION = 1;

const canvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().min(0.25).max(2.5),
});

const canvasNodeSchema = z.object({
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
});

export interface BoardState {
  version: typeof BOARD_VERSION;
  nodes: CanvasNode[];
  viewport: CanvasViewport;
  selectedNodeId: string;
  themeMode: ThemeMode;
}

export function createBoardState(state: Omit<BoardState, "version">): BoardState {
  return {
    version: BOARD_VERSION,
    ...state,
  };
}

export function loadBoardState(): BoardState | null {
  const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
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

export function saveBoardState(board: BoardState) {
  window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
}

export function clearBoardState() {
  window.localStorage.removeItem(BOARD_STORAGE_KEY);
}

export function serializeBoardState(board: BoardState) {
  return JSON.stringify(board, null, 2);
}

export function downloadBoardState(board: BoardState) {
  const blob = new Blob([serializeBoardState(board)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "freeform-board.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
