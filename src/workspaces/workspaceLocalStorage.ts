import { workspaceRecordSchema, type WorkspaceRecord } from "./types";

const VIEW_ORDER_KEY = "freeform-artifacts.view-order.v1";
const DELETED_WORKSPACES_KEY = "freeform-artifacts.deleted-views.v1";
const DELETED_WORKSPACE_PREFIX = "freeform-artifacts.deleted-view.";
const FALLBACK_WORKSPACE_PREFIX = "freeform-artifacts.workspace.";
const RECOVERY_WORKSPACE_PREFIX = "freeform-artifacts.workspace-recovery.";
const RECOVERY_WRITER_ID = crypto.randomUUID();

export interface EmergencyWorkspaceRecoveryExpectation {
  commitId: string;
  revision: number;
  updatedAt: string;
}

export interface EmergencyWorkspaceRecovery {
  workspace: WorkspaceRecord;
  expectedCommit?: EmergencyWorkspaceRecoveryExpectation;
}

function fallbackKey(workspaceId: string) {
  return `freeform-artifacts.workspace.${workspaceId}.v1`;
}

function deletedWorkspaceKey(workspaceId: string) {
  return `${DELETED_WORKSPACE_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function recoveryKey(workspace: WorkspaceRecord) {
  return `${RECOVERY_WORKSPACE_PREFIX}${encodeURIComponent(workspace.templateId)}.${RECOVERY_WRITER_ID}.v1`;
}

function parseEmergencyWorkspaceRecovery(value: unknown): EmergencyWorkspaceRecovery | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as { version?: unknown; workspace?: unknown; expectedCommit?: unknown };
  if (envelope.version !== 1 && envelope.version !== 2) return null;
  const workspace = workspaceRecordSchema.safeParse(envelope.workspace);
  if (!workspace.success) return null;
  if (envelope.expectedCommit === undefined) return { workspace: workspace.data };
  if (!envelope.expectedCommit || typeof envelope.expectedCommit !== "object") return null;
  // Version 1 used only revision and millisecond-resolution updatedAt. An
  // in-flight v1 journal has no trustworthy predecessor identity, so reject
  // the whole envelope rather than allowing a fallback-without-baseline path
  // to promote it after an upgrade.
  if (envelope.version === 1) return null;
  const expected = envelope.expectedCommit as { commitId?: unknown; revision?: unknown; updatedAt?: unknown };
  if (!Number.isInteger(expected.revision) || (expected.revision as number) < 0 ||
    typeof expected.updatedAt !== "string" || !Number.isFinite(Date.parse(expected.updatedAt)) ||
    typeof expected.commitId !== "string" || expected.commitId.length === 0) {
    return null;
  }
  return {
    workspace: workspace.data,
    expectedCommit: {
      commitId: expected.commitId,
      revision: expected.revision as number,
      updatedAt: expected.updatedAt,
    },
  };
}

function readEmergencyWorkspaceRecovery(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return parseEmergencyWorkspaceRecovery(value);
  } catch {
    return null;
  }
}

function readStoredWorkspace(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
    const emergency = parseEmergencyWorkspaceRecovery(value);
    if (emergency) return emergency.workspace;
    const parsed = workspaceRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function candidateIsNewer(candidate: WorkspaceRecord, current: WorkspaceRecord) {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  if (candidate.incarnationId !== current.incarnationId) return false;
  return candidate.updatedAt > current.updatedAt;
}

function recoveryKeysForWorkspace(workspaceId: string) {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(RECOVERY_WORKSPACE_PREFIX)) continue;
    if (readStoredWorkspace(key)?.templateId === workspaceId) keys.push(key);
  }
  return keys;
}

export function listEmergencyWorkspaceRecoveries(workspaceId: string) {
  return recoveryKeysForWorkspace(workspaceId).flatMap((key) => {
    const recovery = readEmergencyWorkspaceRecovery(key);
    return recovery ? [recovery] : [];
  });
}

export function readWorkspaceDeletionId(workspaceId: string) {
  try {
    const value = window.localStorage.getItem(deletedWorkspaceKey(workspaceId));
    return value && value !== "1" ? value : null;
  } catch {
    return null;
  }
}

export function readFallbackWorkspace(workspaceId: string): WorkspaceRecord | null {
  let selected = readCanonicalFallbackWorkspace(workspaceId);
  if (selected?.templateId !== workspaceId) selected = null;
  for (const key of recoveryKeysForWorkspace(workspaceId)) {
    const candidate = readStoredWorkspace(key);
    if (candidate && (!selected || candidateIsNewer(candidate, selected))) selected = candidate;
  }
  return selected;
}

export function readCanonicalFallbackWorkspace(workspaceId: string): WorkspaceRecord | null {
  const workspace = readStoredWorkspace(fallbackKey(workspaceId));
  return workspace?.templateId === workspaceId ? workspace : null;
}

export function writeFallbackWorkspace(workspace: WorkspaceRecord) {
  window.localStorage.setItem(fallbackKey(workspace.templateId), JSON.stringify(workspace));
}

export function writeEmergencyWorkspaceRecovery(
  workspace: WorkspaceRecord,
  expectedCommit?: EmergencyWorkspaceRecoveryExpectation,
) {
  if (readDeletedWorkspaceIds().has(workspace.templateId)) return false;
  try {
    window.localStorage.setItem(recoveryKey(workspace), JSON.stringify({
      version: 2,
      workspace,
      expectedCommit,
    }));
    return true;
  } catch {
    return false;
  }
}

export function removeObsoleteWorkspaceRecoverySnapshots(workspace: WorkspaceRecord) {
  for (const key of recoveryKeysForWorkspace(workspace.templateId)) {
    const recovery = readEmergencyWorkspaceRecovery(key);
    const candidate = recovery?.workspace ?? null;
    const followsThisCommit = Boolean(
      recovery?.expectedCommit &&
      candidate &&
      candidate.incarnationId === workspace.incarnationId &&
      candidate.revision + 1 === workspace.revision &&
      candidate.updatedAt > workspace.updatedAt &&
      recovery.expectedCommit.revision === workspace.revision &&
      recovery.expectedCommit.commitId === workspace.commitId &&
      recovery.expectedCommit.updatedAt === workspace.updatedAt,
    );
    if (followsThisCommit) continue;
    const obsolete = !candidate || candidate.revision < workspace.revision || (
      candidate.revision === workspace.revision && (
        candidate.incarnationId !== workspace.incarnationId ||
        candidate.updatedAt <= workspace.updatedAt
      )
    );
    if (obsolete) window.localStorage.removeItem(key);
  }
}

export function removeFallbackWorkspace(workspaceId: string) {
  try {
    window.localStorage.removeItem(fallbackKey(workspaceId));
    for (const key of recoveryKeysForWorkspace(workspaceId)) window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function listFallbackWorkspaces(): WorkspaceRecord[] {
  const records = new Map<string, WorkspaceRecord>();
  const collect = (prefix: string) => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const candidate = readStoredWorkspace(key);
      if (!candidate) continue;
      const current = records.get(candidate.templateId);
      if (!current || candidateIsNewer(candidate, current)) {
        records.set(candidate.templateId, candidate);
      }
    }
  };
  collect(FALLBACK_WORKSPACE_PREFIX);
  collect(RECOVERY_WORKSPACE_PREFIX);
  return [...records.values()];
}

export function readViewOrder() {
  try {
    const value = JSON.parse(window.localStorage.getItem(VIEW_ORDER_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeViewOrder(ids: string[]) {
  try {
    window.localStorage.setItem(VIEW_ORDER_KEY, JSON.stringify([...new Set(ids)]));
    return true;
  } catch {
    return false;
  }
}

export function readDeletedWorkspaceIds() {
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

export function markWorkspaceDeleted(workspaceId: string, deletionId: string) {
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

export function clearWorkspaceDeletion(workspaceId: string, expectedDeletionId: string) {
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
