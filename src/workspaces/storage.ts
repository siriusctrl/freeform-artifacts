import { clearLegacyBoardState, loadLegacyBoardState } from "../canvas/board";
import { createWorkspaceFromTemplate, migratePublishedExamples } from "./templates";
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
export const WORKSPACE_STORE = "workspaces";
export const ARTIFACT_PACKAGE_STORE = "artifact-packages";
const ACTIVE_WORKSPACE_KEY = "freeform-artifacts.active-view.v1";
const VIEW_ORDER_KEY = "freeform-artifacts.view-order.v1";
const DELETED_WORKSPACES_KEY = "freeform-artifacts.deleted-views.v1";
const workspaceWriteQueues = new Map<string, Promise<unknown>>();

function enqueueWorkspaceWrite<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceWriteQueues.get(workspaceId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const settled = result.finally(() => {
    if (workspaceWriteQueues.get(workspaceId) === settled) {
      workspaceWriteQueues.delete(workspaceId);
    }
  });
  workspaceWriteQueues.set(workspaceId, settled);
  return result;
}

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

async function deleteIndexedWorkspace(workspaceId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      transaction.objectStore(WORKSPACE_STORE).delete(workspaceId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to delete the local canvas"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local canvas deletion was aborted"));
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

function readViewOrder() {
  try {
    const value = JSON.parse(window.localStorage.getItem(VIEW_ORDER_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeViewOrder(ids: string[]) {
  try {
    window.localStorage.setItem(VIEW_ORDER_KEY, JSON.stringify([...new Set(ids)]));
    return true;
  } catch {
    return false;
  }
}

function readDeletedWorkspaceIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DELETED_WORKSPACES_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeDeletedWorkspaceIds(ids: Set<string>) {
  try {
    if (ids.size === 0) window.localStorage.removeItem(DELETED_WORKSPACES_KEY);
    else window.localStorage.setItem(DELETED_WORKSPACES_KEY, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}

function markWorkspaceDeleted(workspaceId: string) {
  const deletedIds = readDeletedWorkspaceIds();
  deletedIds.add(workspaceId);
  return writeDeletedWorkspaceIds(deletedIds);
}

function clearWorkspaceDeletion(workspaceId: string) {
  const deletedIds = readDeletedWorkspaceIds();
  if (!deletedIds.delete(workspaceId)) return true;
  return writeDeletedWorkspaceIds(deletedIds);
}

function ensureWorkspaceOrder(workspaceId: string) {
  const order = readViewOrder();
  if (!order.includes(workspaceId)) writeViewOrder([...order, workspaceId]);
}

function insertWorkspaceOrder(workspaceId: string, index: number) {
  const order = readViewOrder().filter((id) => id !== workspaceId);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, workspaceId);
  writeViewOrder(order);
}

export function writeWorkspaceRecovery(workspace: WorkspaceRecord) {
  const checked = workspaceRecordSchema.parse(workspace);
  try {
    writeFallbackWorkspace(checked);
    return true;
  } catch {
    return false;
  }
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
  const deletedIds = readDeletedWorkspaceIds();
  records = records.filter((workspace) => !deletedIds.has(workspace.templateId));
  const savedOrder = readViewOrder();
  const savedPositions = new Map(savedOrder.map((id, index) => [id, index]));
  records.sort((first, second) => {
    const firstPosition = savedPositions.get(first.templateId);
    const secondPosition = savedPositions.get(second.templateId);
    if (firstPosition !== undefined && secondPosition !== undefined) return firstPosition - secondPosition;
    if (firstPosition !== undefined) return -1;
    if (secondPosition !== undefined) return 1;
    return second.updatedAt.localeCompare(first.updatedAt);
  });
  const normalizedOrder = records.map((workspace) => workspace.templateId);
  if (normalizedOrder.join("\0") !== savedOrder.filter((id) => normalizedOrder.includes(id)).join("\0")) {
    writeViewOrder(normalizedOrder);
  }
  return records
    .map((workspace) => ({
      id: workspace.templateId,
      title: workspace.title,
      updatedAt: workspace.updatedAt,
      previewNodes: createWorkspacePreview(workspace.board.nodes),
    }));
}

export async function loadWorkspaceById(id: string): Promise<WorkspaceLoadResult | null> {
  if (readDeletedWorkspaceIds().has(id)) return null;
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

export async function duplicateWorkspace(
  workspaceId: string,
  currentWorkspace?: WorkspaceRecord,
): Promise<WorkspaceLoadResult> {
  const providedSource = currentWorkspace?.templateId === workspaceId
    ? workspaceRecordSchema.parse(currentWorkspace)
    : null;
  const storedSource = providedSource ? null : await loadWorkspaceById(workspaceId);
  const source = providedSource ?? storedSource?.workspace;
  if (!source) throw new Error(`Unknown canvas view: ${workspaceId}`);
  const id = `canvas-${crypto.randomUUID()}`;
  const workspace: WorkspaceRecord = {
    ...source,
    templateId: id,
    title: `${source.title} copy`.slice(0, 80),
    updatedAt: new Date().toISOString(),
    board: {
      ...structuredClone(source.board),
      selectedNodeId: "",
    },
  };
  const sourceIndex = readViewOrder().indexOf(workspaceId);
  const storage = await saveWorkspace(workspace);
  insertWorkspaceOrder(id, sourceIndex < 0 ? readViewOrder().length : sourceIndex + 1);
  setActiveWorkspaceId(id);
  return { workspace, source: "existing", storage };
}

export async function deleteWorkspace(workspaceId: string, currentWorkspace?: WorkspaceRecord) {
  const providedWorkspace = currentWorkspace?.templateId === workspaceId
    ? workspaceRecordSchema.parse(currentWorkspace)
    : null;
  const storedWorkspace = providedWorkspace ? null : await loadWorkspaceById(workspaceId);
  const existing = providedWorkspace ?? storedWorkspace?.workspace;
  if (!existing) return null;
  await enqueueWorkspaceWrite(workspaceId, async () => {
    const tombstoneSaved = markWorkspaceDeleted(workspaceId);
    let indexedWorkspaceDeleted = false;
    let fallbackWorkspaceDeleted = false;
    try {
      await deleteIndexedWorkspace(workspaceId);
      indexedWorkspaceDeleted = true;
    } catch {
      // A tombstone keeps a temporarily unavailable IndexedDB record hidden.
    }
    try {
      window.localStorage.removeItem(fallbackKey(workspaceId));
      fallbackWorkspaceDeleted = true;
    } catch {
      // The tombstone or IndexedDB deletion can still make the logical delete durable.
    }
    if (!tombstoneSaved && !(indexedWorkspaceDeleted && fallbackWorkspaceDeleted)) {
      throw new Error("Unable to delete this canvas from browser storage");
    }
  });
  writeViewOrder(readViewOrder().filter((id) => id !== workspaceId));
  return existing;
}

export async function restoreWorkspace(workspace: WorkspaceRecord, index: number) {
  const storage = await saveWorkspace({ ...workspace, updatedAt: new Date().toISOString() });
  insertWorkspaceOrder(workspace.templateId, index);
  return storage;
}

export function reorderWorkspaces(sourceId: string, targetId: string) {
  if (sourceId === targetId) return;
  const order = readViewOrder();
  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const movingDown = sourceIndex < targetIndex;
  order.splice(sourceIndex, 1);
  order.splice(order.indexOf(targetId) + (movingDown ? 1 : 0), 0, sourceId);
  writeViewOrder(order);
}

export async function saveWorkspace(workspace: WorkspaceRecord): Promise<"indexeddb" | "localstorage"> {
  const checked = workspaceRecordSchema.parse(workspace);
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    const fallbackSaved = writeWorkspaceRecovery(checked);
    try {
      await writeIndexedWorkspace(checked);
      ensureWorkspaceOrder(checked.templateId);
      clearWorkspaceDeletion(checked.templateId);
      return "indexeddb";
    } catch {
      if (fallbackSaved) {
        ensureWorkspaceOrder(checked.templateId);
        clearWorkspaceDeletion(checked.templateId);
        return "localstorage";
      }
      throw new Error("Unable to save this workspace in browser storage");
    }
  });
}

export interface StoredArtifactPackage {
  artifactId: string;
  moduleSource: string;
  [key: string]: unknown;
}

export async function commitWorkspaceWithArtifactPackage(
  workspace: WorkspaceRecord,
  artifactPackage: StoredArtifactPackage,
) {
  const checked = workspaceRecordSchema.parse(workspace);
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([WORKSPACE_STORE, ARTIFACT_PACKAGE_STORE], "readwrite");
        const packageStore = transaction.objectStore(ARTIFACT_PACKAGE_STORE);
        const existingRequest = packageStore.get(artifactPackage.artifactId);
        let conflict: Error | null = null;

        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as StoredArtifactPackage | undefined;
          if (existing && existing.moduleSource !== artifactPackage.moduleSource) {
            conflict = new Error(
              `Artifact id ${artifactPackage.artifactId} is already installed with different code; use a new artifactId`,
            );
            transaction.abort();
            return;
          }
          packageStore.put({ ...artifactPackage, installedAt: new Date().toISOString() });
          transaction.objectStore(WORKSPACE_STORE).put(checked);
        };
        existingRequest.onerror = () => reject(existingRequest.error ?? new Error("Unable to inspect artifact package"));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(conflict ?? transaction.error ?? new Error("Unable to install artifact"));
        transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error("Artifact installation was aborted"));
      });
    } finally {
      database.close();
    }
    writeWorkspaceRecovery(checked);
    clearWorkspaceDeletion(checked.templateId);
    return "indexeddb" as const;
  });
}

export async function loadOrCreateWorkspace(template: WorkspaceTemplate): Promise<WorkspaceLoadResult> {
  const requestedId = new URLSearchParams(window.location.search).get("view");
  const activeId = requestedId ?? window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (activeId) {
    const active = await loadWorkspaceById(activeId);
    if (active) {
      const workspace = migratePublishedExamples(active.workspace, template);
      if (workspace !== active.workspace) {
        active.storage = await saveWorkspace(workspace);
        active.workspace = workspace;
      }
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
    const workspace = migratePublishedExamples(existing, template);
    if (workspace !== existing) {
      storage = await saveWorkspace(workspace);
      existing = workspace;
    }
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
