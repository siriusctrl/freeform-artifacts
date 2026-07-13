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
  return enqueueWorkspaceWrite(checked.templateId, async () => {
    const fallbackSaved = writeWorkspaceRecovery(checked);
    try {
      await writeIndexedWorkspace(checked);
      return "indexeddb";
    } catch {
      if (fallbackSaved) {
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
    const database = await openDatabase();
    let committedWorkspace = checked;
    try {
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
        options.signal?.addEventListener("abort", abortTransaction, { once: true });
        const finish = () => options.signal?.removeEventListener("abort", abortTransaction);
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
          const installedAt = new Date().toISOString();
          for (const artifactPackage of artifactPackages) {
            packageStore.put({ ...artifactPackage, installedAt });
          }
          const current = workspaceRecordSchema.safeParse(workspaceRequest.result);
          if (relayReceipt && current.success) {
            const deliveredNodeIds = new Set(relayReceipt.nodeIds);
            const existingNodeIds = new Set(current.data.board.nodes.map((node) => node.id));
            const deliveredNodes = checked.board.nodes.filter((node) =>
              deliveredNodeIds.has(node.id) && !existingNodeIds.has(node.id));
            committedWorkspace = {
              ...current.data,
              updatedAt: checked.updatedAt,
              board: {
                ...current.data.board,
                nodes: [...current.data.board.nodes, ...deliveredNodes],
                selectedNodeId: checked.board.selectedNodeId,
              },
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
