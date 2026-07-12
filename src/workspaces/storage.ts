import { clearLegacyBoardState, loadLegacyBoardState } from "../canvas/board";
import { createWorkspaceFromTemplate } from "./templates";
import { createWorkspacePreview } from "./preview";
import {
  workspaceRecordSchema,
  type WorkspaceLoadResult,
  type WorkspaceRecord,
  type WorkspaceSummary,
  type WorkspaceTemplate,
} from "./types";

export const WORKSPACE_DATABASE_NAME = "freeform-artifacts";
const DATABASE_VERSION = 2;
const WORKSPACE_STORE = "workspaces";
export const ARTIFACT_PACKAGE_STORE = "artifact-packages";
const ACTIVE_WORKSPACE_KEY = "freeform-artifacts.active-view.v1";

function fallbackKey(templateId: string) {
  return `freeform-artifacts.workspace.${templateId}.v1`;
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WORKSPACE_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "templateId" });
      }
      if (!database.objectStoreNames.contains(ARTIFACT_PACKAGE_STORE)) {
        database.createObjectStore(ARTIFACT_PACKAGE_STORE, { keyPath: "artifactId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local workspace database"));
    request.onblocked = () => reject(new Error("The local workspace database is blocked by another tab"));
  });
}

async function readIndexedWorkspace(templateId: string): Promise<WorkspaceRecord | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(WORKSPACE_STORE, "readonly").objectStore(WORKSPACE_STORE).get(templateId);
      request.onsuccess = () => {
        const parsed = workspaceRecordSchema.safeParse(request.result);
        resolve(parsed.success ? parsed.data : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read the local workspace"));
    });
  } finally {
    database.close();
  }
}

async function listIndexedWorkspaces(): Promise<WorkspaceRecord[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(WORKSPACE_STORE, "readonly").objectStore(WORKSPACE_STORE).getAll();
      request.onsuccess = () => resolve(
        request.result.flatMap((value) => {
          const parsed = workspaceRecordSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        }),
      );
      request.onerror = () => reject(request.error ?? new Error("Unable to list local canvases"));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedWorkspace(workspace: WorkspaceRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      transaction.objectStore(WORKSPACE_STORE).put(workspace);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save the local workspace"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local workspace save was aborted"));
    });
  } finally {
    database.close();
  }
}

function readFallbackWorkspace(templateId: string): WorkspaceRecord | null {
  try {
    const parsed = workspaceRecordSchema.safeParse(JSON.parse(window.localStorage.getItem(fallbackKey(templateId)) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeFallbackWorkspace(workspace: WorkspaceRecord) {
  window.localStorage.setItem(fallbackKey(workspace.templateId), JSON.stringify(workspace));
}

function listFallbackWorkspaces(): WorkspaceRecord[] {
  const prefix = "freeform-artifacts.workspace.";
  const records: WorkspaceRecord[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const parsed = workspaceRecordSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? "null"));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // Ignore malformed fallback entries and keep scanning.
    }
  }
  return records;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  let records: WorkspaceRecord[];
  try {
    records = await listIndexedWorkspaces();
  } catch {
    records = listFallbackWorkspaces();
  }
  return records
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    .map((workspace) => ({
      id: workspace.templateId,
      title: workspace.title,
      updatedAt: workspace.updatedAt,
      previewNodes: createWorkspacePreview(workspace.board.nodes),
    }));
}

export async function loadWorkspaceById(id: string): Promise<WorkspaceLoadResult | null> {
  let storage: WorkspaceLoadResult["storage"] = "indexeddb";
  let workspace: WorkspaceRecord | null = null;
  const fallback = readFallbackWorkspace(id);
  try {
    workspace = await readIndexedWorkspace(id);
    if (fallback && (!workspace || fallback.updatedAt > workspace.updatedAt)) {
      workspace = fallback;
      await writeIndexedWorkspace(fallback);
    }
  } catch {
    storage = "localstorage";
    workspace = fallback;
  }
  return workspace ? { workspace, source: "existing", storage } : null;
}

export function setActiveWorkspaceId(id: string) {
  window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
}

export async function createWorkspace(template: WorkspaceTemplate): Promise<WorkspaceLoadResult> {
  const id = `canvas-${crypto.randomUUID()}`;
  const workspace = createWorkspaceFromTemplate(template, { id, title: "Untitled canvas", empty: true });
  const storage = await saveWorkspace(workspace);
  setActiveWorkspaceId(id);
  return { workspace, source: "template", storage };
}

export async function saveWorkspace(workspace: WorkspaceRecord): Promise<"indexeddb" | "localstorage"> {
  const checked = workspaceRecordSchema.parse(workspace);
  let fallbackSaved = false;
  try {
    writeFallbackWorkspace(checked);
    fallbackSaved = true;
  } catch {
    // IndexedDB remains the primary path when a large workspace exceeds the fallback quota.
  }

  try {
    await writeIndexedWorkspace(checked);
    return "indexeddb";
  } catch {
    if (fallbackSaved) {
      return "localstorage";
    }
    throw new Error("Unable to save this workspace in browser storage");
  }
}

export async function loadOrCreateWorkspace(template: WorkspaceTemplate): Promise<WorkspaceLoadResult> {
  const requestedId = new URLSearchParams(window.location.search).get("view");
  const activeId = requestedId ?? window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (activeId) {
    const active = await loadWorkspaceById(activeId);
    if (active) {
      setActiveWorkspaceId(activeId);
      return active;
    }
  }

  let storage: WorkspaceLoadResult["storage"] = "indexeddb";
  let existing: WorkspaceRecord | null = null;
  const fallback = readFallbackWorkspace(template.id);

  try {
    existing = await readIndexedWorkspace(template.id);
    if (fallback && (!existing || fallback.updatedAt > existing.updatedAt)) {
      existing = fallback;
      await writeIndexedWorkspace(fallback);
    }
  } catch {
    storage = "localstorage";
    existing = fallback;
  }

  if (existing) {
    setActiveWorkspaceId(existing.templateId);
    return { workspace: existing, source: "existing", storage };
  }

  const legacyBoard = template.id === "market-overview" ? loadLegacyBoardState() : null;
  const workspace = createWorkspaceFromTemplate(template);
  if (legacyBoard) {
    workspace.board = legacyBoard;
  }

  storage = await saveWorkspace(workspace);
  setActiveWorkspaceId(workspace.templateId);
  if (legacyBoard) {
    clearLegacyBoardState();
  }

  return {
    workspace,
    source: legacyBoard ? "legacy" : "template",
    storage,
  };
}
