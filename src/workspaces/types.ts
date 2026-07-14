import { z } from "zod";
import { boardStateSchema, type BoardState } from "../canvas/board";

export const WORKSPACE_VERSION = 1;

export function createWorkspaceIncarnationId() {
  return crypto.randomUUID();
}

export function createWorkspaceCommitId() {
  return crypto.randomUUID();
}

function createLegacyWorkspaceIncarnationId(workspaceId: string) {
  // Legacy IndexedDB and recovery-mirror copies must converge on the same
  // identity even when each is parsed before either migration is persisted.
  return `legacy:${encodeURIComponent(workspaceId)}`;
}

export const workspaceRecordSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  revision: z.number().int().nonnegative().default(0),
  incarnationId: z.string().min(1).optional(),
  commitId: z.string().min(1).optional(),
  templateId: z.string().min(1),
  title: z.string().trim().min(1).max(80).optional(),
  templateVersion: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  board: boardStateSchema,
}).transform((workspace) => {
  const incarnationId = workspace.incarnationId ?? createLegacyWorkspaceIncarnationId(workspace.templateId);
  return {
    ...workspace,
    incarnationId,
    commitId: workspace.commitId ??
      `legacy:${encodeURIComponent(incarnationId)}:${workspace.revision}:${encodeURIComponent(workspace.updatedAt)}`,
    title: workspace.title ?? (workspace.templateId === "market-overview" ? "Market overview" : "Untitled canvas"),
  };
});

export interface WorkspaceRecord {
  version: typeof WORKSPACE_VERSION;
  revision: number;
  incarnationId: string;
  commitId: string;
  templateId: string;
  title: string;
  templateVersion: number;
  updatedAt: string;
  board: BoardState;
}

export interface WorkspaceSummary {
  id: string;
  incarnationId: string;
  title: string;
  updatedAt: string;
  previewNodes: WorkspacePreviewNode[];
}

export interface WorkspacePreviewNode {
  id: string;
  artifactId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
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
