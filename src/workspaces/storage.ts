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
const DATABASE_VERSION = 3;
export const WORKSPACE_STORE = "workspaces";
export const ARTIFACT_PACKAGE_STORE = "artifact-packages";
export const RELAY_RECEIPT_STORE = "relay-receipts";
const ACTIVE_WORKSPACE_KEY = "freeform-artifacts.active-view.v1";
const RELAY_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const VIEW_ORDER_KEY = "freeform-artifacts.view-order.v1";
const DELETED_WORKSPACES_KEY = "freeform-artifacts.deleted-views.v1";
const DELETED_WORKSPACE_PREFIX = "freeform-artifacts.deleted-view.";
const workspaceWriteQueues = new Map<string, Promise<unknown>>();

export class WorkspaceDeletedError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super("This canvas was deleted in another browser tab. Restore it before saving more edits.");
    this.name = "WorkspaceDeletedError";
    this.workspaceId = workspaceId;
  }
}

export class WorkspaceConflictError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super("This canvas changed in another browser tab. Reload it before saving more edits.");
    this.name = "WorkspaceConflictError";
    this.workspaceId = workspaceId;
  }
}

function enqueueWorkspaceWrite<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceWriteQueues.get(workspaceId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const queueTail = result.then(() => undefined, () => undefined);
  workspaceWriteQueues.set(workspaceId, queueTail);
  void queueTail.finally(() => {
    if (workspaceWriteQueues.get(workspaceId) === queueTail) {
      workspaceWriteQueues.delete(workspaceId);
    }
  });
  return result;
}

function fallbackKey(templateId: string) {
  return `freeform-artifacts.workspace.${templateId}.v1`;
}

function deletedWorkspaceKey(workspaceId: string) {
  return `${DELETED_WORKSPACE_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function readWorkspaceDeletionId(workspaceId: string) {
  try {
    const value = window.localStorage.getItem(deletedWorkspaceKey(workspaceId));
    return value && value !== "1" ? value : null;
  } catch {
    return null;
  }
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
      if (!database.objectStoreNames.contains(RELAY_RECEIPT_STORE)) {
        database.createObjectStore(RELAY_RECEIPT_STORE, { keyPath: "id" });
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

type WorkspaceWriteMode = "save" | "restore" | "recovery";

async function writeIndexedWorkspace(
  workspace: WorkspaceRecord,
  mode: WorkspaceWriteMode,
  deletionId?: string,
): Promise<WorkspaceRecord> {
  const database = await openDatabase();
  let committedWorkspace = workspace;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      const store = transaction.objectStore(WORKSPACE_STORE);
      const request = store.get(workspace.templateId);
      let conflict: Error | null = null;
      request.onsuccess = () => {
        if (readDeletedWorkspaceIds().has(workspace.templateId) && mode !== "restore") {
          conflict = new WorkspaceDeletedError(workspace.templateId);
          transaction.abort();
          return;
        }
        const current = workspaceRecordSchema.safeParse(request.result);
        if (mode === "restore") {
          const tombstoned = readDeletedWorkspaceIds().has(workspace.templateId);
          const currentDeletionId = readWorkspaceDeletionId(workspace.templateId);
          if (!tombstoned || !deletionId || currentDeletionId !== deletionId ||
            (current.success && current.data.revision !== workspace.revision)) {
            conflict = new WorkspaceConflictError(workspace.templateId);
            transaction.abort();
            return;
          }
        }
        if (mode === "save") {
          const currentRevision = current.success ? current.data.revision : 0;
          const recordExists = current.success;
          const fallback = readFallbackWorkspace(workspace.templateId);
          const resumesFallbackCommit = currentRevision < workspace.revision &&
            fallback?.revision === workspace.revision;
          if ((!resumesFallbackCommit && currentRevision !== workspace.revision) ||
            (!recordExists && workspace.revision !== 0 && !resumesFallbackCommit)) {
            conflict = new WorkspaceConflictError(workspace.templateId);
            transaction.abort();
            return;
          }
        }
        if (mode === "recovery" && current.success) {
          const recoveryIsNewer = workspace.revision > current.data.revision || (
            workspace.revision === current.data.revision && workspace.updatedAt > current.data.updatedAt
          );
          if (!recoveryIsNewer) {
            conflict = new WorkspaceConflictError(workspace.templateId);
            transaction.abort();
            return;
          }
        }
        committedWorkspace = {
          ...workspace,
          revision: Math.max(workspace.revision, current.success ? current.data.revision : 0) + 1,
        };
        store.put(committedWorkspace);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to inspect the local workspace revision"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(conflict ?? transaction.error ?? new Error("Unable to save the local workspace"));
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error("Local workspace save was aborted"));
    });
    return committedWorkspace;
  } finally {
    database.close();
  }
}

async function deleteIndexedWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
  const database = await openDatabase();
  let deletedWorkspace: WorkspaceRecord | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      const store = transaction.objectStore(WORKSPACE_STORE);
      const request = store.get(workspaceId);
      request.onsuccess = () => {
        const parsed = workspaceRecordSchema.safeParse(request.result);
        deletedWorkspace = parsed.success ? parsed.data : null;
        store.delete(workspaceId);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to inspect the canvas before deletion"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to delete the local canvas"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local canvas deletion was aborted"));
    });
    return deletedWorkspace;
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
  const deletedIds = new Set<string>();
  const legacyIds = new Set<string>();
  try {
    const value = JSON.parse(window.localStorage.getItem(DELETED_WORKSPACES_KEY) ?? "[]");
    if (Array.isArray(value)) {
      for (const id of value) {
        if (typeof id === "string") {
          deletedIds.add(id);
          legacyIds.add(id);
        }
      }
    }
  } catch {
    // Per-view tombstones below remain authoritative if the legacy index is malformed.
  }
  if (legacyIds.size > 0) {
    let migrated = true;
    for (const id of legacyIds) {
      try {
        const key = deletedWorkspaceKey(id);
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, "1");
      } catch {
        migrated = false;
      }
    }
    if (migrated) {
      try {
        window.localStorage.removeItem(DELETED_WORKSPACES_KEY);
      } catch {
        // Keep the legacy index as a fallback if cleanup is unavailable.
      }
    }
  }
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(DELETED_WORKSPACE_PREFIX)) continue;
    try {
      deletedIds.add(decodeURIComponent(key.slice(DELETED_WORKSPACE_PREFIX.length)));
    } catch {
      // Ignore malformed keys created outside the application.
    }
  }
  return deletedIds;
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

function markWorkspaceDeleted(workspaceId: string, deletionId: string) {
  readDeletedWorkspaceIds();
  try {
    window.localStorage.setItem(deletedWorkspaceKey(workspaceId), deletionId);
    return { durable: true, generationSaved: true };
  } catch {
    // The legacy aggregate remains a fallback for older browser data.
  }
  const deletedIds = readDeletedWorkspaceIds();
  deletedIds.add(workspaceId);
  return { durable: writeDeletedWorkspaceIds(deletedIds), generationSaved: false };
}

function clearWorkspaceDeletion(workspaceId: string, expectedDeletionId: string) {
  readDeletedWorkspaceIds();
  if (readWorkspaceDeletionId(workspaceId) !== expectedDeletionId) return false;
  try {
    window.localStorage.removeItem(deletedWorkspaceKey(workspaceId));
  } catch {
    return false;
  }
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
  if (readDeletedWorkspaceIds().has(checked.templateId)) return false;
  try {
    const current = readFallbackWorkspace(checked.templateId);
    if (current && (
      current.revision > checked.revision ||
      (current.revision === checked.revision && current.updatedAt >= checked.updatedAt)
    )) return true;
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

async function loadStoredWorkspace(id: string): Promise<WorkspaceLoadResult | null> {
  if (readDeletedWorkspaceIds().has(id)) return null;
  const fallback = readFallbackWorkspace(id);
  try {
    let workspace = await readIndexedWorkspace(id);
    const fallbackIsNewer = fallback && (!workspace || fallback.revision > workspace.revision || (
      fallback.revision === workspace.revision && fallback.updatedAt > workspace.updatedAt
    ));
    if (fallbackIsNewer) {
      try {
        workspace = await writeIndexedWorkspace(fallback, "recovery");
      } catch (error) {
        if (error instanceof WorkspaceDeletedError) return null;
        if (!(error instanceof WorkspaceConflictError)) throw error;
        workspace = await readIndexedWorkspace(id);
      }
    }
    if (readDeletedWorkspaceIds().has(id)) return null;
    if (workspace) writeWorkspaceRecovery(workspace);
    return workspace ? { workspace, source: "existing", storage: "indexeddb" } : null;
  } catch (error) {
    if (error instanceof WorkspaceDeletedError) return null;
    if (readDeletedWorkspaceIds().has(id)) return null;
    return fallback ? { workspace: fallback, source: "existing", storage: "localstorage" } : null;
  }
}

export async function loadWorkspaceById(id: string): Promise<WorkspaceLoadResult | null> {
  return loadStoredWorkspace(id);
}

export function setActiveWorkspaceId(id: string) {
  window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
}

export async function createWorkspace(template: WorkspaceTemplate): Promise<WorkspaceLoadResult> {
  const id = `canvas-${crypto.randomUUID()}`;
  const workspace = createWorkspaceFromTemplate(template, { id, title: "Untitled canvas", empty: true });
  const saved = await saveWorkspace(workspace);
  setActiveWorkspaceId(id);
  return { workspace: saved.workspace, source: "template", storage: saved.storage };
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
    revision: 0,
    templateId: id,
    title: `${source.title} copy`.slice(0, 80),
    updatedAt: new Date().toISOString(),
    board: {
      ...structuredClone(source.board),
      selectedNodeId: "",
    },
  };
  const sourceIndex = readViewOrder().indexOf(workspaceId);
  const saved = await saveWorkspace(workspace);
  insertWorkspaceOrder(id, sourceIndex < 0 ? readViewOrder().length : sourceIndex + 1);
  setActiveWorkspaceId(id);
  return { workspace: saved.workspace, source: "existing", storage: saved.storage };
}

export interface WorkspaceDeletion {
  deletionId: string | null;
  workspace: WorkspaceRecord;
}

export async function deleteWorkspace(
  workspaceId: string,
  currentWorkspace?: WorkspaceRecord,
): Promise<WorkspaceDeletion | null> {
  const providedWorkspace = currentWorkspace?.templateId === workspaceId
    ? workspaceRecordSchema.parse(currentWorkspace)
    : null;
  const storedWorkspace = providedWorkspace ? null : await loadWorkspaceById(workspaceId);
  const existing = providedWorkspace ?? storedWorkspace?.workspace;
  if (!existing) return null;
  const deletionId = crypto.randomUUID();
  const deleted = await enqueueWorkspaceWrite(workspaceId, async () => {
    const tombstone = markWorkspaceDeleted(workspaceId, deletionId);
    let indexedWorkspaceDeleted = false;
    let fallbackWorkspaceDeleted = false;
    let deletedIndexedWorkspace: WorkspaceRecord | null = null;
    const fallbackWorkspace = readFallbackWorkspace(workspaceId);
    try {
      deletedIndexedWorkspace = await deleteIndexedWorkspace(workspaceId);
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
    if (!tombstone.durable && !(indexedWorkspaceDeleted && fallbackWorkspaceDeleted)) {
      throw new Error("Unable to delete this canvas from browser storage");
    }
    const candidates = [deletedIndexedWorkspace, fallbackWorkspace, existing]
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));
    const workspace = candidates.sort((first, second) =>
      second.revision - first.revision || second.updatedAt.localeCompare(first.updatedAt)
    )[0] ?? null;
    return workspace ? {
      deletionId: tombstone.generationSaved ? deletionId : null,
      workspace,
    } : null;
  });
  writeViewOrder(readViewOrder().filter((id) => id !== workspaceId));
  return deleted;
}

export async function restoreWorkspace(workspace: WorkspaceRecord, index: number, deletionId: string) {
  const saved = await persistWorkspace(
    workspaceRecordSchema.parse({ ...workspace, updatedAt: new Date().toISOString() }),
    "restore",
    deletionId,
  );
  insertWorkspaceOrder(workspace.templateId, index);
  return saved.storage;
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

export interface WorkspaceSaveResult {
  storage: "indexeddb" | "localstorage";
  workspace: WorkspaceRecord;
}

function writeFallbackWorkspaceVersioned(
  workspace: WorkspaceRecord,
  mode: Exclude<WorkspaceWriteMode, "recovery">,
  deletionId?: string,
) {
  const tombstoned = readDeletedWorkspaceIds().has(workspace.templateId);
  if (tombstoned && mode !== "restore") {
    throw new WorkspaceDeletedError(workspace.templateId);
  }
  const current = readFallbackWorkspace(workspace.templateId);
  if (mode === "restore" && (
    !tombstoned || !deletionId || readWorkspaceDeletionId(workspace.templateId) !== deletionId ||
    (current && current.revision !== workspace.revision)
  )) {
    throw new WorkspaceConflictError(workspace.templateId);
  }
  if (mode === "save") {
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== workspace.revision || (!current && workspace.revision !== 0)) {
      throw new WorkspaceConflictError(workspace.templateId);
    }
  }
  const committed = {
    ...workspace,
    revision: Math.max(workspace.revision, current?.revision ?? 0) + 1,
  };
  writeFallbackWorkspace(committed);
  return committed;
}

async function persistWorkspace(
  checked: WorkspaceRecord,
  mode: Exclude<WorkspaceWriteMode, "recovery">,
  deletionId?: string,
): Promise<WorkspaceSaveResult> {
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    let committed: WorkspaceRecord;
    try {
      committed = await writeIndexedWorkspace(checked, mode, deletionId);
      ensureWorkspaceOrder(checked.templateId);
      if (mode === "restore" && (!deletionId || !clearWorkspaceDeletion(checked.templateId, deletionId))) {
        throw new WorkspaceConflictError(checked.templateId);
      }
      writeWorkspaceRecovery(committed);
      return { storage: "indexeddb", workspace: committed };
    } catch (error) {
      if (error instanceof WorkspaceDeletedError || error instanceof WorkspaceConflictError) throw error;
      try {
        committed = writeFallbackWorkspaceVersioned(checked, mode, deletionId);
      } catch (fallbackError) {
        if (fallbackError instanceof WorkspaceDeletedError || fallbackError instanceof WorkspaceConflictError) {
          throw fallbackError;
        }
        throw new Error("Unable to save this workspace in browser storage");
      }
      ensureWorkspaceOrder(checked.templateId);
      if (mode === "restore" && (!deletionId || !clearWorkspaceDeletion(checked.templateId, deletionId))) {
        throw new WorkspaceConflictError(checked.templateId);
      }
      return { storage: "localstorage", workspace: committed };
    }
  });
}

export async function saveWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceSaveResult> {
  return persistWorkspace(workspaceRecordSchema.parse(workspace), "save");
}

export interface StoredArtifactPackage {
  artifactId: string;
  moduleSource: string;
  [key: string]: unknown;
}

export interface RelayInstallReceipt {
  id: string;
  sessionId: string;
  deliveryId: string;
  targetViewId: string;
  artifactIds: string[];
  nodeIds: string[];
  installedAt: string;
}

export class RelayReceiptAlreadyExistsError extends Error {
  readonly receiptId: string;

  constructor(receiptId: string) {
    super("Relay delivery was already committed by another browser tab");
    this.name = "RelayReceiptAlreadyExistsError";
    this.receiptId = receiptId;
  }
}

export function relayReceiptId(sessionId: string, deliveryId: string) {
  return `${sessionId}:${deliveryId}`;
}

export async function loadRelayInstallReceipt(sessionId: string, deliveryId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<RelayInstallReceipt | null>((resolve, reject) => {
      const request = database.transaction(RELAY_RECEIPT_STORE, "readonly")
        .objectStore(RELAY_RECEIPT_STORE)
        .get(relayReceiptId(sessionId, deliveryId));
      request.onsuccess = () => {
        const value = request.result as RelayInstallReceipt | undefined;
        resolve(
          value && value.sessionId === sessionId && value.deliveryId === deliveryId &&
            Array.isArray(value.artifactIds) && Array.isArray(value.nodeIds)
            ? value
            : null,
        );
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to inspect relay delivery receipt"));
    });
  } finally {
    database.close();
  }
}

export async function commitWorkspaceWithArtifactPackage(
  workspace: WorkspaceRecord,
  artifactPackage: StoredArtifactPackage,
) {
  return commitWorkspaceWithArtifactPackages(workspace, [artifactPackage]);
}

export async function commitWorkspaceWithArtifactPackages(
  workspace: WorkspaceRecord,
  artifactPackages: StoredArtifactPackage[],
  relayReceipt?: RelayInstallReceipt,
  options: { signal?: AbortSignal } = {},
) {
  const checked = workspaceRecordSchema.parse(workspace);
  if (!artifactPackages.length) throw new Error("At least one artifact package is required");
  const packageIds = new Set<string>();
  for (const artifactPackage of artifactPackages) {
    if (packageIds.has(artifactPackage.artifactId)) {
      throw new Error(`Artifact id ${artifactPackage.artifactId} appears more than once in this delivery`);
    }
    packageIds.add(artifactPackage.artifactId);
  }
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    if (options.signal?.aborted) throw new DOMException("Build Session is no longer active", "AbortError");
    if (readDeletedWorkspaceIds().has(checked.templateId)) {
      throw new WorkspaceDeletedError(checked.templateId);
    }
    const database = await openDatabase();
    let committedWorkspace = checked;
    try {
      if (options.signal?.aborted) throw new DOMException("Build Session is no longer active", "AbortError");
      await new Promise<void>((resolve, reject) => {
        const stores = relayReceipt
          ? [WORKSPACE_STORE, ARTIFACT_PACKAGE_STORE, RELAY_RECEIPT_STORE]
          : [WORKSPACE_STORE, ARTIFACT_PACKAGE_STORE];
        const transaction = database.transaction(stores, "readwrite");
        const abortTransaction = () => {
          try {
            transaction.abort();
          } catch {
            // The transaction already reached a terminal state.
          }
        };
        const finish = () => options.signal?.removeEventListener("abort", abortTransaction);
        options.signal?.addEventListener("abort", abortTransaction, { once: true });
        if (options.signal?.aborted) {
          finish();
          abortTransaction();
          reject(new DOMException("Build Session is no longer active", "AbortError"));
          return;
        }
        const packageStore = transaction.objectStore(ARTIFACT_PACKAGE_STORE);
        const workspaceStore = transaction.objectStore(WORKSPACE_STORE);
        let duplicateReceipt = false;
        if (relayReceipt) {
          const receiptStore = transaction.objectStore(RELAY_RECEIPT_STORE);
          const receiptRequest = receiptStore.add(relayReceipt);
          receiptRequest.onerror = () => {
            duplicateReceipt = receiptRequest.error?.name === "ConstraintError";
          };
          const pruneRequest = receiptStore.getAll();
          pruneRequest.onsuccess = () => {
            const cutoff = Date.now() - RELAY_RECEIPT_RETENTION_MS;
            for (const value of pruneRequest.result as RelayInstallReceipt[]) {
              const installedAt = Date.parse(value.installedAt);
              if (!Number.isFinite(installedAt) || installedAt < cutoff) receiptStore.delete(value.id);
            }
          };
        }
        const existingRequest = packageStore.getAll();
        const workspaceRequest = workspaceStore.get(checked.templateId);
        let packagesReady = false;
        let workspaceReady = false;
        let conflict: Error | null = null;

        const commitWhenReady = () => {
          if (!packagesReady || !workspaceReady) return;
          if (readDeletedWorkspaceIds().has(checked.templateId)) {
            conflict = new WorkspaceDeletedError(checked.templateId);
            transaction.abort();
            return;
          }
          const existingById = new Map(
            (existingRequest.result as StoredArtifactPackage[]).map((entry) => [entry.artifactId, entry]),
          );
          for (const artifactPackage of artifactPackages) {
            const existing = existingById.get(artifactPackage.artifactId);
            if (existing && existing.moduleSource !== artifactPackage.moduleSource) {
              conflict = new Error(
                `Artifact id ${artifactPackage.artifactId} is already installed with different code; use a new artifactId`,
              );
              transaction.abort();
              return;
            }
          }
          const current = workspaceRecordSchema.safeParse(workspaceRequest.result);
          if (!current.success) {
            conflict = relayReceipt
              ? new WorkspaceDeletedError(checked.templateId)
              : new WorkspaceConflictError(checked.templateId);
            transaction.abort();
            return;
          }
          if (!relayReceipt && current.data.revision !== checked.revision) {
            conflict = new WorkspaceConflictError(checked.templateId);
            transaction.abort();
            return;
          }

          const installedAt = new Date().toISOString();
          for (const artifactPackage of artifactPackages) {
            packageStore.put({ ...artifactPackage, installedAt });
          }
          if (relayReceipt) {
            const deliveredNodeIds = new Set(relayReceipt.nodeIds);
            const existingNodeIds = new Set(current.data.board.nodes.map((node) => node.id));
            const deliveredNodes = checked.board.nodes.filter((node) =>
              deliveredNodeIds.has(node.id) && !existingNodeIds.has(node.id));
            committedWorkspace = {
              ...current.data,
              revision: current.data.revision + 1,
              updatedAt: checked.updatedAt,
              board: {
                ...current.data.board,
                nodes: [...current.data.board.nodes, ...deliveredNodes],
                selectedNodeId: checked.board.selectedNodeId,
              },
            };
          } else {
            committedWorkspace = {
              ...checked,
              revision: current.data.revision + 1,
            };
          }
          workspaceStore.put(committedWorkspace);
        };

        existingRequest.onsuccess = () => {
          packagesReady = true;
          commitWhenReady();
        };
        existingRequest.onerror = () => reject(existingRequest.error ?? new Error("Unable to inspect artifact package"));
        workspaceRequest.onsuccess = () => {
          workspaceReady = true;
          commitWhenReady();
        };
        workspaceRequest.onerror = () => reject(workspaceRequest.error ?? new Error("Unable to inspect target workspace"));
        transaction.oncomplete = () => {
          finish();
          resolve();
        };
        transaction.onerror = () => {
          finish();
          reject(
            duplicateReceipt && relayReceipt
              ? new RelayReceiptAlreadyExistsError(relayReceipt.id)
              : conflict ?? transaction.error ?? new Error("Unable to install artifact"),
          );
        };
        transaction.onabort = () => {
          finish();
          reject(
            options.signal?.aborted
              ? new DOMException("Build Session is no longer active", "AbortError")
              : duplicateReceipt && relayReceipt
                ? new RelayReceiptAlreadyExistsError(relayReceipt.id)
                : conflict ?? transaction.error ?? new Error("Artifact installation was aborted"),
          );
        };
      });
    } finally {
      database.close();
    }
    writeWorkspaceRecovery(committedWorkspace);
    return { storage: "indexeddb" as const, workspace: committedWorkspace };
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
        const saved = await saveWorkspace(workspace);
        active.storage = saved.storage;
        active.workspace = saved.workspace;
      }
      setActiveWorkspaceId(activeId);
      return active;
    }
  }

  const existing = await loadStoredWorkspace(template.id);
  if (existing) {
    const workspace = migratePublishedExamples(existing.workspace, template);
    if (workspace !== existing.workspace) {
      const saved = await saveWorkspace(workspace);
      existing.storage = saved.storage;
      existing.workspace = saved.workspace;
    }
    setActiveWorkspaceId(existing.workspace.templateId);
    return existing;
  }

  const templateWasDeleted = readDeletedWorkspaceIds().has(template.id);
  const legacyBoard = template.id === "market-overview" && !templateWasDeleted ? loadLegacyBoardState() : null;
  const workspace = createWorkspaceFromTemplate(
    template,
    templateWasDeleted ? { id: `canvas-${crypto.randomUUID()}` } : undefined,
  );
  if (legacyBoard) {
    workspace.board = legacyBoard;
  }

  const saved = await saveWorkspace(workspace);
  setActiveWorkspaceId(saved.workspace.templateId);
  if (legacyBoard) {
    clearLegacyBoardState();
  }

  return {
    workspace: saved.workspace,
    source: legacyBoard ? "legacy" : "template",
    storage: saved.storage,
  };
}
