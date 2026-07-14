import {
  ARTIFACT_PACKAGE_STORE,
  openDatabase,
  RELAY_RECEIPT_STORE,
  WORKSPACE_STORE,
} from "./database";
import { WorkspaceConflictError, WorkspaceDeletedError } from "./errors";
import { createWorkspaceCommitId, workspaceRecordSchema, type WorkspaceRecord } from "./types";

const RELAY_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

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
  targetViewIncarnationId: string;
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
            typeof value.targetViewIncarnationId === "string" && value.targetViewIncarnationId.length > 0 &&
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

export interface ArtifactPackageTransactionOptions {
  expectedIncarnationId: string;
  expectedRevision: number;
  isWorkspaceDeleted: () => boolean;
  signal?: AbortSignal;
}

/**
 * Atomically commits executable packages, one exact workspace revision, and an
 * optional relay receipt. The caller owns per-workspace serialization and the
 * localStorage recovery mirror; this function owns the IndexedDB transaction.
 */
export async function commitArtifactPackagesTransaction(
  workspace: WorkspaceRecord,
  artifactPackages: StoredArtifactPackage[],
  relayReceipt: RelayInstallReceipt | undefined,
  options: ArtifactPackageTransactionOptions,
) {
  if (relayReceipt && relayReceipt.targetViewIncarnationId !== options.expectedIncarnationId) {
    throw new WorkspaceConflictError(workspace.templateId);
  }
  const database = await openDatabase();
  let committedWorkspace = workspace;
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
        const pruneRequest = receiptStore.openCursor();
        pruneRequest.onsuccess = () => {
          const cursor = pruneRequest.result;
          if (!cursor) return;
          const cutoff = Date.now() - RELAY_RECEIPT_RETENTION_MS;
          const value = cursor.value as RelayInstallReceipt;
          const installedAt = Date.parse(value.installedAt);
          if (!Number.isFinite(installedAt) || installedAt < cutoff) cursor.delete();
          cursor.continue();
        };
      }

      const workspaceRequest = workspaceStore.get(workspace.templateId);
      const existingPackages: StoredArtifactPackage[] = [];
      let pendingPackageReads = artifactPackages.length;
      let packagesReady = pendingPackageReads === 0;
      let workspaceReady = false;
      let conflict: Error | null = null;

      const commitWhenReady = () => {
        if (!packagesReady || !workspaceReady) return;
        if (options.isWorkspaceDeleted()) {
          conflict = new WorkspaceDeletedError(workspace.templateId);
          transaction.abort();
          return;
        }

        const existingById = new Map(
          existingPackages.map((entry) => [entry.artifactId, entry]),
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
            ? new WorkspaceDeletedError(workspace.templateId)
            : new WorkspaceConflictError(workspace.templateId);
          transaction.abort();
          return;
        }
        if (
          current.data.revision !== options.expectedRevision ||
          current.data.incarnationId !== options.expectedIncarnationId
        ) {
          conflict = new WorkspaceConflictError(workspace.templateId);
          transaction.abort();
          return;
        }

        const installedAt = new Date().toISOString();
        for (const artifactPackage of artifactPackages) {
          packageStore.put({ ...artifactPackage, installedAt });
        }
        committedWorkspace = {
          ...workspace,
          incarnationId: current.data.incarnationId,
          commitId: createWorkspaceCommitId(),
          revision: current.data.revision + 1,
        };
        workspaceStore.put(committedWorkspace);
      };

      for (const artifactPackage of artifactPackages) {
        const packageRequest = packageStore.get(artifactPackage.artifactId);
        packageRequest.onsuccess = () => {
          if (packageRequest.result) existingPackages.push(packageRequest.result as StoredArtifactPackage);
          pendingPackageReads -= 1;
          packagesReady = pendingPackageReads === 0;
          commitWhenReady();
        };
        packageRequest.onerror = () => reject(
          packageRequest.error ?? new Error("Unable to inspect artifact package"),
        );
      }
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
          options.signal?.aborted
            ? new DOMException("Build Session is no longer active", "AbortError")
            : duplicateReceipt && relayReceipt
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
    return committedWorkspace;
  } finally {
    database.close();
  }
}
