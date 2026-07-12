import { z } from "zod";
import { boardStateSchema, type BoardState } from "../canvas/board";

export const WORKSPACE_VERSION = 1;

export const workspaceRecordSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  board: boardStateSchema,
});

export interface WorkspaceRecord {
  version: typeof WORKSPACE_VERSION;
  templateId: string;
  templateVersion: number;
  updatedAt: string;
  board: BoardState;
}

export interface WorkspaceTemplate {
  id: string;
  version: number;
  title: string;
  description: string;
  createBoard: () => BoardState;
}

export interface WorkspaceLoadResult {
  workspace: WorkspaceRecord;
  source: "existing" | "legacy" | "template";
  storage: "indexeddb" | "localstorage";
}
