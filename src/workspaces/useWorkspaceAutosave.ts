import { useCallback, useEffect, useRef } from "react";
import { saveWorkspace, writeWorkspaceRecovery } from "./storage";
import type { WorkspaceLoadResult, WorkspaceRecord } from "./types";

const SAVE_DEBOUNCE_MS = 180;

interface UseWorkspaceAutosaveOptions {
  onError: (message: string) => void;
  onSaving: () => void;
  onSaved: (storage: WorkspaceLoadResult["storage"]) => void;
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
  const shouldSkip = useRef(skipInitialSave);
  const callbacks = useRef({ onError, onSaved, onSaving });
  latestWorkspace.current = workspace;
  callbacks.current = { onError, onSaved, onSaving };

  const cancelPendingSave = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (shouldSkip.current) {
      shouldSkip.current = false;
      return;
    }

    cancelPendingSave();
    callbacks.current.onSaving();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      saveWorkspace(latestWorkspace.current)
        .then((storage) => callbacks.current.onSaved(storage))
        .catch((error) => callbacks.current.onError(
          error instanceof Error ? error.message : "Local save failed",
        ));
    }, SAVE_DEBOUNCE_MS);

    return cancelPendingSave;
  }, [cancelPendingSave, workspace]);

  useEffect(() => {
    const flushRecovery = () => {
      cancelPendingSave();
      writeWorkspaceRecovery(latestWorkspace.current);
    };
    window.addEventListener("pagehide", flushRecovery);
    return () => {
      window.removeEventListener("pagehide", flushRecovery);
      flushRecovery();
    };
  }, [cancelPendingSave]);

  return { cancelPendingSave };
}
