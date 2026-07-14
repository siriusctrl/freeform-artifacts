import { clearLegacyBoardState, loadLegacyBoardState } from "../canvas/board";
import {
  commitArtifactPackagesTransaction,
  loadRelayInstallReceipt,
  relayReceiptId,
  RelayReceiptAlreadyExistsError,
  type RelayInstallReceipt,
  type StoredArtifactPackage,
} from "./artifactPackageStorage";
import {
  ARTIFACT_PACKAGE_STORE,
  openDatabase,
  WORKSPACE_DATABASE_NAME,
  WORKSPACE_STORE,
} from "./database";
import { WorkspaceConflictError, WorkspaceDeletedError } from "./errors";
import { createWorkspaceFromTemplate, migratePublishedExamples } from "./templates";
import { createWorkspacePreview } from "./preview";
import {
  createWorkspaceCommitId,
  createWorkspaceIncarnationId,
  workspaceRecordSchema,
  type WorkspaceLoadResult,
  type WorkspaceRecord,
  type WorkspaceSummary,
  type WorkspaceTemplate,
} from "./types";
import {
  clearWorkspaceDeletion,
  listEmergencyWorkspaceRecoveries,
  listFallbackWorkspaces,
  markWorkspaceDeleted,
  readCanonicalFallbackWorkspace,
  readDeletedWorkspaceIds,
  readFallbackWorkspace,
  readViewOrder,
  readWorkspaceDeletionId,
  removeFallbackWorkspace,
  removeObsoleteWorkspaceRecoverySnapshots,
  writeEmergencyWorkspaceRecovery,
  writeFallbackWorkspace,
  writeViewOrder,
  type EmergencyWorkspaceRecovery,
  type EmergencyWorkspaceRecoveryExpectation,
} from "./workspaceLocalStorage";

export {
  loadRelayInstallReceipt,
  openDatabase,
  relayReceiptId,
  RelayReceiptAlreadyExistsError,
  ARTIFACT_PACKAGE_STORE,
  WORKSPACE_DATABASE_NAME,
  WORKSPACE_STORE,
  WorkspaceConflictError,
  WorkspaceDeletedError,
};
export type { RelayInstallReceipt, StoredArtifactPackage };

const ACTIVE_WORKSPACE_KEY = "freeform-artifacts.active-view.v1";
const WORKSPACE_WRITE_LOCK_PREFIX = "freeform-artifacts.workspace-write:";
const workspaceWriteQueues = new Map<string, Promise<unknown>>();

class WorkspaceFallbackLockUnavailableError extends Error {
  constructor() {
    super("Safe browser fallback requires Web Locks support");
    this.name = "WorkspaceFallbackLockUnavailableError";
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

function workspaceWriteLockName(workspaceId: string) {
  return `${WORKSPACE_WRITE_LOCK_PREFIX}${encodeURIComponent(workspaceId)}`;
}

async function withWorkspaceWriteLock<T>(
  workspaceId: string,
  operation: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!navigator.locks?.request) {
    throw new WorkspaceFallbackLockUnavailableError();
  }
  return navigator.locks.request(
    workspaceWriteLockName(workspaceId),
    { mode: "exclusive", signal },
    operation,
  );
}

async function withOptionalWorkspaceWriteLock<T>(
  workspaceId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  if (!navigator.locks?.request) return operation();
  return withWorkspaceWriteLock(workspaceId, operation);
}

function needsIdentityMigration(value: unknown, workspace: WorkspaceRecord) {
  return !value || typeof value !== "object" ||
    (value as { incarnationId?: unknown }).incarnationId !== workspace.incarnationId ||
    (value as { commitId?: unknown }).commitId !== workspace.commitId;
}

async function readIndexedWorkspace(templateId: string): Promise<WorkspaceRecord | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      const store = transaction.objectStore(WORKSPACE_STORE);
      const request = store.get(templateId);
      let workspace: WorkspaceRecord | null = null;
      request.onsuccess = () => {
        const parsed = workspaceRecordSchema.safeParse(request.result);
        workspace = parsed.success ? parsed.data : null;
        if (workspace && needsIdentityMigration(request.result, workspace)) {
          store.put(workspace);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read the local workspace"));
      transaction.oncomplete = () => resolve(workspace);
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to migrate the local workspace"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local workspace migration was aborted"));
    });
  } finally {
    database.close();
  }
}

async function listIndexedWorkspaces(): Promise<WorkspaceRecord[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      const store = transaction.objectStore(WORKSPACE_STORE);
      const request = store.getAll();
      let workspaces: WorkspaceRecord[] = [];
      request.onsuccess = () => {
        workspaces = request.result.flatMap((value) => {
          const parsed = workspaceRecordSchema.safeParse(value);
          if (!parsed.success) return [];
          if (needsIdentityMigration(value, parsed.data)) store.put(parsed.data);
          return [parsed.data];
        });
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to list local canvases"));
      transaction.oncomplete = () => resolve(workspaces);
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to migrate local canvases"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local canvas migration was aborted"));
    });
  } finally {
    database.close();
  }
}

type WorkspaceWriteMode = "save" | "restore" | "recovery";

interface WorkspaceRestoreExpectation {
  deletionId: string;
  incarnationId: string;
  revision: number;
}

async function writeIndexedWorkspace(
  workspace: WorkspaceRecord,
  mode: WorkspaceWriteMode,
  restoreExpectation?: WorkspaceRestoreExpectation,
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
          if (!tombstoned || !restoreExpectation || currentDeletionId !== restoreExpectation.deletionId ||
            (current.success && (
              current.data.revision !== restoreExpectation.revision ||
              current.data.incarnationId !== restoreExpectation.incarnationId
            ))) {
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
            fallback?.revision === workspace.revision &&
            fallback.incarnationId === workspace.incarnationId;
          if ((!resumesFallbackCommit && currentRevision !== workspace.revision) ||
            (!recordExists && workspace.revision !== 0 && !resumesFallbackCommit) ||
            (current.success && current.data.incarnationId !== workspace.incarnationId)) {
            conflict = new WorkspaceConflictError(workspace.templateId);
            transaction.abort();
            return;
          }
        }
        if (mode === "recovery" && current.success) {
          if (workspace.incarnationId !== current.data.incarnationId) {
            conflict = new WorkspaceConflictError(workspace.templateId);
            transaction.abort();
            return;
          }
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

async function deleteIndexedWorkspace(
  workspaceId: string,
  expectedIncarnationId: string,
): Promise<WorkspaceRecord | null> {
  const database = await openDatabase();
  let deletedWorkspace: WorkspaceRecord | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
      const store = transaction.objectStore(WORKSPACE_STORE);
      const request = store.get(workspaceId);
      let conflict: Error | null = null;
      request.onsuccess = () => {
        const parsed = workspaceRecordSchema.safeParse(request.result);
        if (parsed.success && parsed.data.incarnationId !== expectedIncarnationId) {
          conflict = new WorkspaceConflictError(workspaceId);
          transaction.abort();
          return;
        }
        deletedWorkspace = parsed.success ? parsed.data : null;
        store.delete(workspaceId);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to inspect the canvas before deletion"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(conflict ?? transaction.error ?? new Error("Unable to delete the local canvas"));
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error("Local canvas deletion was aborted"));
    });
    return deletedWorkspace;
  } finally {
    database.close();
  }
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

function writeWorkspaceRecoveryUnlocked(workspace: WorkspaceRecord) {
  if (readDeletedWorkspaceIds().has(workspace.templateId)) return false;
  const current = readFallbackWorkspace(workspace.templateId);
  if (current) {
    if (current.revision > workspace.revision) return true;
    if (current.revision === workspace.revision) {
      if (current.incarnationId !== workspace.incarnationId) return true;
      if (current.updatedAt > workspace.updatedAt) return true;
    }
  }
  writeFallbackWorkspace(workspace);
  removeObsoleteWorkspaceRecoverySnapshots(workspace);
  return true;
}

export function writeWorkspaceEmergencyRecovery(
  workspace: WorkspaceRecord,
  expectedCommit?: EmergencyWorkspaceRecoveryExpectation,
) {
  const checked = workspaceRecordSchema.parse(workspace);
  if (expectedCommit && expectedCommit.revision !== checked.revision + 1) return false;
  return writeEmergencyWorkspaceRecovery(checked, expectedCommit);
}

export async function writeWorkspaceRecovery(workspace: WorkspaceRecord) {
  const checked = workspaceRecordSchema.parse(workspace);
  try {
    // Fallback commits use this same lock around their own versioned write.
    // Keep recovery acquisition at the public boundary so neither path ever
    // requests the non-reentrant Web Lock while already holding it.
    return await withWorkspaceWriteLock(checked.templateId, () =>
      writeWorkspaceRecoveryUnlocked(checked));
  } catch {
    return false;
  }
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
      incarnationId: workspace.incarnationId,
      title: workspace.title,
      updatedAt: workspace.updatedAt,
      previewNodes: createWorkspacePreview(workspace.board.nodes),
    }));
}

function selectEmergencyRecovery(
  current: WorkspaceRecord | null,
  recoveries: EmergencyWorkspaceRecovery[],
) {
  return recoveries.flatMap((recovery) => {
    const candidate = recovery.workspace;
    if (!current) return [candidate];
    if (
      candidate.incarnationId !== current.incarnationId ||
      candidate.updatedAt <= current.updatedAt
    ) {
      return [];
    }
    if (candidate.revision === current.revision && candidate.commitId === current.commitId) {
      return [{ ...candidate, revision: current.revision }];
    }
    if (
      candidate.revision + 1 === current.revision &&
      recovery.expectedCommit?.revision === current.revision &&
      recovery.expectedCommit.commitId === current.commitId &&
      recovery.expectedCommit.updatedAt === current.updatedAt
    ) {
      return [{ ...candidate, revision: current.revision }];
    }
    return [];
  }).sort((first, second) =>
    second.revision - first.revision || second.updatedAt.localeCompare(first.updatedAt)
  )[0] ?? null;
}

function workspaceCandidateIsNewer(candidate: WorkspaceRecord, current: WorkspaceRecord | null) {
  if (!current) return true;
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  return candidate.incarnationId === current.incarnationId && candidate.updatedAt > current.updatedAt;
}

function commitFallbackEmergencyRecoveryUnlocked(id: string) {
  if (readDeletedWorkspaceIds().has(id)) return null;
  const current = readCanonicalFallbackWorkspace(id);
  const recovery = selectEmergencyRecovery(current, listEmergencyWorkspaceRecoveries(id));
  if (!recovery) return current ?? readFallbackWorkspace(id);
  const committed = {
    ...recovery,
    commitId: createWorkspaceCommitId(),
    revision: Math.max(recovery.revision, current?.revision ?? recovery.revision) + 1,
  };
  writeFallbackWorkspace(committed);
  removeObsoleteWorkspaceRecoverySnapshots(committed);
  return committed;
}

async function loadStoredWorkspace(id: string): Promise<WorkspaceLoadResult | null> {
  if (readDeletedWorkspaceIds().has(id)) return null;
  const fallback = readFallbackWorkspace(id);
  const emergencyRecoveries = listEmergencyWorkspaceRecoveries(id);
  try {
    let workspace = await readIndexedWorkspace(id);
    const fallbackIsNewer = fallback && (!workspace || fallback.revision > workspace.revision || (
      fallback.revision === workspace.revision && fallback.updatedAt > workspace.updatedAt
    ));
    let recovery = fallbackIsNewer ? fallback : null;
    const emergencyRecovery = selectEmergencyRecovery(workspace, emergencyRecoveries);
    if (emergencyRecovery && workspaceCandidateIsNewer(emergencyRecovery, recovery)) {
      recovery = emergencyRecovery;
    }
    if (recovery) {
      try {
        workspace = await writeIndexedWorkspace({
          ...recovery,
          commitId: createWorkspaceCommitId(),
        }, "recovery");
      } catch (error) {
        if (error instanceof WorkspaceDeletedError) return null;
        if (!(error instanceof WorkspaceConflictError)) throw error;
        workspace = await readIndexedWorkspace(id);
      }
    }
    if (readDeletedWorkspaceIds().has(id)) return null;
    if (workspace) await writeWorkspaceRecovery(workspace);
    return workspace ? { workspace, source: "existing", storage: "indexeddb" } : null;
  } catch (error) {
    if (error instanceof WorkspaceDeletedError) return null;
    if (readDeletedWorkspaceIds().has(id)) return null;
    try {
      const recovered = await withWorkspaceWriteLock(id, () =>
        commitFallbackEmergencyRecoveryUnlocked(id));
      return recovered ? { workspace: recovered, source: "existing", storage: "localstorage" } : null;
    } catch {
      return fallback ? { workspace: fallback, source: "existing", storage: "localstorage" } : null;
    }
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
    incarnationId: createWorkspaceIncarnationId(),
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
  const deleted = await enqueueWorkspaceWrite(workspaceId, () => withOptionalWorkspaceWriteLock(workspaceId, async () => {
    const tombstone = markWorkspaceDeleted(workspaceId, deletionId);
    let indexedWorkspaceDeleted = false;
    let fallbackWorkspaceDeleted = false;
    let deletedIndexedWorkspace: WorkspaceRecord | null = null;
    const fallbackWorkspace = readFallbackWorkspace(workspaceId);
    try {
      deletedIndexedWorkspace = await deleteIndexedWorkspace(workspaceId, existing.incarnationId);
      indexedWorkspaceDeleted = true;
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        if (tombstone.generationSaved) clearWorkspaceDeletion(workspaceId, deletionId);
        throw error;
      }
      if (fallbackWorkspace && fallbackWorkspace.incarnationId !== existing.incarnationId) {
        if (tombstone.generationSaved) clearWorkspaceDeletion(workspaceId, deletionId);
        throw new WorkspaceConflictError(workspaceId);
      }
      // A tombstone keeps a temporarily unavailable IndexedDB record hidden.
    }
    fallbackWorkspaceDeleted = removeFallbackWorkspace(workspaceId);
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
  }));
  writeViewOrder(readViewOrder().filter((id) => id !== workspaceId));
  return deleted;
}

export async function restoreWorkspace(workspace: WorkspaceRecord, index: number, deletionId: string) {
  const deletedWorkspace = workspaceRecordSchema.parse(workspace);
  const restoreExpectation: WorkspaceRestoreExpectation = {
    deletionId,
    incarnationId: deletedWorkspace.incarnationId,
    revision: deletedWorkspace.revision,
  };
  const saved = await persistWorkspace(
    {
      ...deletedWorkspace,
      incarnationId: createWorkspaceIncarnationId(),
      commitId: createWorkspaceCommitId(),
      updatedAt: new Date().toISOString(),
    },
    "restore",
    restoreExpectation,
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
  restoreExpectation?: WorkspaceRestoreExpectation,
) {
  const tombstoned = readDeletedWorkspaceIds().has(workspace.templateId);
  if (tombstoned && mode !== "restore") {
    throw new WorkspaceDeletedError(workspace.templateId);
  }
  const current = readFallbackWorkspace(workspace.templateId);
  if (mode === "restore" && (
    !tombstoned || !restoreExpectation ||
    readWorkspaceDeletionId(workspace.templateId) !== restoreExpectation.deletionId ||
    (current && (
      current.revision !== restoreExpectation.revision ||
      current.incarnationId !== restoreExpectation.incarnationId
    ))
  )) {
    throw new WorkspaceConflictError(workspace.templateId);
  }
  if (mode === "save") {
    const currentRevision = current?.revision ?? 0;
    if (
      currentRevision !== workspace.revision ||
      (!current && workspace.revision !== 0) ||
      (current && current.incarnationId !== workspace.incarnationId)
    ) {
      throw new WorkspaceConflictError(workspace.templateId);
    }
  }
  const committed = {
    ...workspace,
    revision: Math.max(workspace.revision, current?.revision ?? 0) + 1,
  };
  writeFallbackWorkspace(committed);
  removeObsoleteWorkspaceRecoverySnapshots(committed);
  return committed;
}

async function persistWorkspace(
  checked: WorkspaceRecord,
  mode: Exclude<WorkspaceWriteMode, "recovery">,
  restoreExpectation?: WorkspaceRestoreExpectation,
): Promise<WorkspaceSaveResult> {
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    let committed: WorkspaceRecord;
    try {
      committed = await writeIndexedWorkspace(checked, mode, restoreExpectation);
      ensureWorkspaceOrder(checked.templateId);
      if (mode === "restore" && (
        !restoreExpectation ||
        !clearWorkspaceDeletion(checked.templateId, restoreExpectation.deletionId)
      )) {
        throw new WorkspaceConflictError(checked.templateId);
      }
      await writeWorkspaceRecovery(committed);
      return { storage: "indexeddb", workspace: committed };
    } catch (error) {
      if (error instanceof WorkspaceDeletedError || error instanceof WorkspaceConflictError) throw error;
      try {
        committed = await withWorkspaceWriteLock(checked.templateId, () =>
          writeFallbackWorkspaceVersioned(checked, mode, restoreExpectation));
      } catch (fallbackError) {
        if (
          fallbackError instanceof WorkspaceDeletedError ||
          fallbackError instanceof WorkspaceConflictError ||
          fallbackError instanceof WorkspaceFallbackLockUnavailableError
        ) {
          throw fallbackError;
        }
        throw new Error("Unable to save this workspace in browser storage");
      }
      ensureWorkspaceOrder(checked.templateId);
      if (mode === "restore" && (
        !restoreExpectation ||
        !clearWorkspaceDeletion(checked.templateId, restoreExpectation.deletionId)
      )) {
        throw new WorkspaceConflictError(checked.templateId);
      }
      return { storage: "localstorage", workspace: committed };
    }
  });
}

export async function saveWorkspace(
  workspace: WorkspaceRecord,
  options: { commitId?: string } = {},
): Promise<WorkspaceSaveResult> {
  return persistWorkspace({
    ...workspaceRecordSchema.parse(workspace),
    commitId: options.commitId ?? createWorkspaceCommitId(),
  }, "save");
}

export async function commitWorkspaceWithArtifactPackage(
  workspace: WorkspaceRecord,
  artifactPackage: StoredArtifactPackage,
) {
  return commitWorkspaceWithArtifactPackages(workspace, [artifactPackage]);
}

export interface ArtifactPackageCommitOptions {
  expectedIncarnationId?: string;
  expectedRevision?: number;
  signal?: AbortSignal;
}

export async function commitWorkspaceWithArtifactPackages(
  workspace: WorkspaceRecord,
  artifactPackages: StoredArtifactPackage[],
  relayReceipt?: RelayInstallReceipt,
  options: ArtifactPackageCommitOptions = {},
) {
  const checked = workspaceRecordSchema.parse(workspace);
  const expectedIncarnationId = options.expectedIncarnationId ?? checked.incarnationId;
  const expectedRevision = options.expectedRevision ?? checked.revision;
  if (
    checked.incarnationId !== expectedIncarnationId ||
    checked.revision !== expectedRevision ||
    (options.expectedIncarnationId === undefined) !== (options.expectedRevision === undefined)
  ) {
    throw new WorkspaceConflictError(checked.templateId);
  }
  if (relayReceipt && (
    relayReceipt.targetViewId !== checked.templateId ||
    relayReceipt.targetViewIncarnationId !== expectedIncarnationId
  )) {
    throw new WorkspaceConflictError(checked.templateId);
  }
  if (!artifactPackages.length) throw new Error("At least one artifact package is required");
  const packageIds = new Set<string>();
  for (const artifactPackage of artifactPackages) {
    if (packageIds.has(artifactPackage.artifactId)) {
      throw new Error(`Artifact id ${artifactPackage.artifactId} appears more than once in this delivery`);
    }
    packageIds.add(artifactPackage.artifactId);
  }
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    const commit = async () => {
      if (options.signal?.aborted) throw new DOMException("Build Session is no longer active", "AbortError");
      if (readDeletedWorkspaceIds().has(checked.templateId)) {
        throw new WorkspaceDeletedError(checked.templateId);
      }
      return commitArtifactPackagesTransaction(
        checked,
        artifactPackages,
        relayReceipt,
        {
          expectedIncarnationId,
          expectedRevision,
          isWorkspaceDeleted: () => readDeletedWorkspaceIds().has(checked.templateId),
          signal: options.signal,
        },
      );
    };
    // Relay delivery and deletion share this cross-tab lock. A deletion that
    // reaches the lock first leaves a tombstone before delivery can enter its
    // IndexedDB transaction; a transaction that wins first commits before the
    // deletion begins. Without Web Locks, relay delivery fails closed while
    // ordinary offline package installation retains its single-tab behavior.
    const committedWorkspace = relayReceipt
      ? await withWorkspaceWriteLock(checked.templateId, commit, options.signal)
      : await commit();
    await writeWorkspaceRecovery(committedWorkspace);
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
