import { createBoardState } from "../canvas/board";
import { INITIAL_VIEWPORT } from "../canvas/constants";
import { initialNodes } from "../canvas/seeds/demoBoard";
import type { WorkspaceTemplate } from "./types";

export const DEFAULT_TEMPLATE_ID = "market-overview";

function initialTemplateViewport() {
  if (window.innerWidth <= 640) {
    return { x: -180, y: 28, scale: 0.48 };
  }
  return { ...INITIAL_VIEWPORT };
}

const templates: Record<string, WorkspaceTemplate> = {
  [DEFAULT_TEMPLATE_ID]: {
    id: DEFAULT_TEMPLATE_ID,
    version: 3,
    title: "Market overview",
    description: "A working canvas of database-backed metrics, probability, and flow artifacts.",
    createBoard: () =>
      createBoardState({
        nodes: structuredClone(initialNodes),
        viewport: initialTemplateViewport(),
        selectedNodeId: "node-revenue",
        themeMode: "light",
        snapToGrid: true,
      }),
  },
};

export function getRequestedTemplate(): WorkspaceTemplate {
  const templateId = new URLSearchParams(window.location.search).get("board") ?? DEFAULT_TEMPLATE_ID;
  return templates[templateId] ?? templates[DEFAULT_TEMPLATE_ID];
}

export function createWorkspaceFromTemplate(
  template: WorkspaceTemplate,
  options: { id?: string; title?: string; empty?: boolean } = {},
) {
  const board = template.createBoard();
  return {
    version: 1 as const,
    templateId: options.id ?? template.id,
    title: options.title ?? template.title,
    templateVersion: template.version,
    updatedAt: new Date().toISOString(),
    board: options.empty ? { ...board, nodes: [], selectedNodeId: "" } : board,
  };
}
