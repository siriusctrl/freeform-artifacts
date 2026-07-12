import { clearLegacyBoardState, loadLegacyBoardState } from "../canvas/board";
import { createWorkspaceFromTemplate } from "./templates";
import {
  workspaceRecordSchema,
  type WorkspaceLoadResult,
  type WorkspaceRecord,
  type WorkspaceTemplate,
} from "./types";

export const WORKSPACE_DATABASE_NAME = "freeform-artifacts";
const DATABASE_VERSION = 1;
const WORKSPACE_STORE = "workspaces";

function fallbackKey(templateId: string) {
  return `freeform-artifacts.workspace.${templateId}.v1`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WORKSPACE_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "templateId" });
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
    return { workspace: existing, source: "existing", storage };
  }

  const legacyBoard = template.id === "market-overview" ? loadLegacyBoardState() : null;
  const workspace = createWorkspaceFromTemplate(template);
  if (legacyBoard) {
    workspace.board = legacyBoard;
  }

  storage = await saveWorkspace(workspace);
  if (legacyBoard) {
    clearLegacyBoardState();
  }

  return {
    workspace,
    source: legacyBoard ? "legacy" : "template",
    storage,
  };
}
