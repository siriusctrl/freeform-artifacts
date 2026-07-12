import { workspaceRecordSchema, type WorkspaceRecord } from "./types";

export function serializeWorkspace(workspace: WorkspaceRecord) {
  return JSON.stringify(workspaceRecordSchema.parse(workspace), null, 2);
}

export function parseWorkspace(source: string) {
  return workspaceRecordSchema.parse(JSON.parse(source));
}

export function downloadWorkspace(workspace: WorkspaceRecord) {
  const blob = new Blob([serializeWorkspace(workspace)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${workspace.templateId}.freeform.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
