import { z } from "zod";
import { boardStateSchema, type BoardState } from "../canvas/board";

export const WORKSPACE_VERSION = 1;

export const workspaceRecordSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  templateId: z.string().min(1),
  title: z.string().trim().min(1).max(80).optional(),
  templateVersion: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  board: boardStateSchema,
}).transform((workspace) => ({
  ...workspace,
  title: workspace.title ?? (workspace.templateId === "market-overview" ? "Market overview" : "Untitled canvas"),
}));

export interface WorkspaceRecord {
  version: typeof WORKSPACE_VERSION;
  templateId: string;
  title: string;
  templateVersion: number;
  updatedAt: string;
  board: BoardState;
}

export interface WorkspaceSummary {
  id: string;
  title: string;
  updatedAt: string;
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
