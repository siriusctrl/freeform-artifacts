import { createBoardState } from "../canvas/board";
import { INITIAL_VIEWPORT } from "../canvas/constants";
import { initialNodes } from "../canvas/seeds/demoBoard";
import type { WorkspaceRecord, WorkspaceTemplate } from "./types";

export const DEFAULT_TEMPLATE_ID = "market-overview";
const REFRESHED_EXAMPLE_NODE_IDS = new Set(["node-probability", "node-flow", "node-sankey"]);

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
    revision: 0,
    templateId: options.id ?? template.id,
    title: options.title ?? template.title,
    templateVersion: template.version,
    updatedAt: new Date().toISOString(),
    board: options.empty ? { ...board, nodes: [], selectedNodeId: "" } : board,
  };
}

export function migratePublishedExamples(workspace: WorkspaceRecord, template: WorkspaceTemplate) {
  if (
    workspace.templateId !== template.id ||
    template.id !== DEFAULT_TEMPLATE_ID ||
    workspace.templateVersion >= template.version
  ) {
    return workspace;
  }

  const authoredNodes = new Map(template.createBoard().nodes.map((node) => [node.id, node]));
  return {
    ...workspace,
    templateVersion: template.version,
    updatedAt: new Date().toISOString(),
    board: {
      ...workspace.board,
      nodes: workspace.board.nodes.map((node) => {
        if (!REFRESHED_EXAMPLE_NODE_IDS.has(node.id)) return node;
        const authored = authoredNodes.get(node.id);
        return authored
          ? { ...node, title: authored.title, data: structuredClone(authored.data) }
          : node;
      }),
    },
  };
}
