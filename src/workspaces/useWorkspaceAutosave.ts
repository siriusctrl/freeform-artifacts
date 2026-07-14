import { useCallback, useEffect, useRef } from "react";
import { saveWorkspace, writeWorkspaceRecovery, type WorkspaceSaveResult } from "./storage";
import type { WorkspaceRecord } from "./types";

const SAVE_DEBOUNCE_MS = 400;

interface UseWorkspaceAutosaveOptions {
  onError: (message: string) => void;
  onSaving: () => void;
  onSaved: (result: WorkspaceSaveResult) => void;
  skipInitialSave: boolean;
  workspace: WorkspaceRecord;
}

export function useWorkspaceAutosave({
  onError,
  onSaved,
  onSaving,
  skipInitialSave,
  workspace,
}: UseWorkspaceAutosaveOptions) {
  const latestWorkspace = useRef(workspace);
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const recoveryEnabled = useRef(true);
  const shouldSkip = useRef(skipInitialSave);
  const dirty = useRef(!skipInitialSave);
  const knownRevision = useRef(workspace.revision);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onError, onSaved, onSaving });
  latestWorkspace.current = workspace;
  knownRevision.current = Math.max(knownRevision.current, workspace.revision);
  callbacks.current = { onError, onSaved, onSaving };

  const cancelPendingSave = useCallback(() => {
    generation.current += 1;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const skipNextSave = useCallback(() => {
    cancelPendingSave();
    dirty.current = false;
    shouldSkip.current = true;
  }, [cancelPendingSave]);

  const suppressRecovery = useCallback(() => {
    recoveryEnabled.current = false;
    cancelPendingSave();
  }, [cancelPendingSave]);

  const resumeRecovery = useCallback(() => {
    recoveryEnabled.current = true;
  }, []);

  const enqueueSave = useCallback((candidate: WorkspaceRecord) => {
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      const result = await saveWorkspace({ ...candidate, revision: knownRevision.current });
      knownRevision.current = result.workspace.revision;
      latestWorkspace.current = {
        ...latestWorkspace.current,
        revision: result.workspace.revision,
      };
      return result;
    });
    saveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const flushPendingSave = useCallback(async () => {
    let latestResult: WorkspaceSaveResult | null = null;
    while (dirty.current) {
      cancelPendingSave();
      const flushGeneration = generation.current;
      callbacks.current.onSaving();
      try {
        latestResult = await enqueueSave(latestWorkspace.current);
      } catch (error) {
        callbacks.current.onError(error instanceof Error ? error.message : "Local save failed");
        throw error;
      }
      if (flushGeneration === generation.current) {
        dirty.current = false;
        shouldSkip.current = true;
        callbacks.current.onSaved(latestResult);
      }
    }
    return latestResult;
  }, [cancelPendingSave, enqueueSave]);

  useEffect(() => {
    if (shouldSkip.current) {
      shouldSkip.current = false;
      return;
    }

    dirty.current = true;
    cancelPendingSave();
    callbacks.current.onSaving();
    const saveGeneration = generation.current;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const candidate = latestWorkspace.current;
      void enqueueSave(candidate).then((result) => {
        if (saveGeneration === generation.current) {
          dirty.current = false;
          shouldSkip.current = true;
          callbacks.current.onSaved(result);
        }
      }).catch((error) => {
        if (saveGeneration === generation.current) {
          callbacks.current.onError(error instanceof Error ? error.message : "Local save failed");
        }
      });
    }, SAVE_DEBOUNCE_MS);

    return cancelPendingSave;
  }, [cancelPendingSave, enqueueSave, workspace]);

  useEffect(() => {
    const flushRecovery = () => {
      cancelPendingSave();
      if (recoveryEnabled.current) writeWorkspaceRecovery(latestWorkspace.current);
    };
    window.addEventListener("pagehide", flushRecovery);
    return () => {
      window.removeEventListener("pagehide", flushRecovery);
      flushRecovery();
    };
  }, [cancelPendingSave]);

  return { cancelPendingSave, flushPendingSave, resumeRecovery, skipNextSave, suppressRecovery };
}
