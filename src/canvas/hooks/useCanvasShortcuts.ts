import { useEffect } from "react";

interface UseCanvasShortcutsOptions {
  disabled: boolean;
  artifactLibraryOpen: boolean;
  presentationMode: boolean;
  selectedNodeIds: string[];
  onCopy: () => void;
  onDeleteSelection: () => void;
  onDismiss: () => void;
  onDuplicate: () => void;
  onExitPresentation: () => void;
  onNextView: () => void;
  onPaste: () => void;
  onPreviousView: () => void;
  onRedo: () => void;
  onResetView: () => void;
  onSelectAll: () => void;
  onToggleArtifacts: () => void;
  onToggleViews: () => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function isCanvasDeleteTarget(target: EventTarget | null) {
  if (target === document.body || target === document.documentElement) return true;
  return target instanceof Element && Boolean(target.closest(".canvas-stage"));
}

export function useCanvasShortcuts({
  disabled,
  artifactLibraryOpen,
  presentationMode,
  selectedNodeIds,
  onCopy,
  onDeleteSelection,
  onDismiss,
  onDuplicate,
  onExitPresentation,
  onNextView,
  onPaste,
  onPreviousView,
  onRedo,
  onResetView,
  onSelectAll,
  onToggleArtifacts,
  onToggleViews,
  onUndo,
  onZoomIn,
  onZoomOut,
}: UseCanvasShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (disabled || isEditableTarget(event.target)) return;

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (artifactLibraryOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        } else if (modifier && !event.shiftKey && key === "b") {
          event.preventDefault();
          onToggleViews();
        } else if (modifier && event.shiftKey && key === "a") {
          event.preventDefault();
          onToggleArtifacts();
        }
        return;
      }

      if (presentationMode) {
        if (event.key === "Escape") {
          event.preventDefault();
          onExitPresentation();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          onPreviousView();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onNextView();
        }
        return;
      }

      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (event.ctrlKey && !event.metaKey && key === "y") {
        event.preventDefault();
        onRedo();
        return;
      }
      if (modifier && !event.shiftKey && key === "b") {
        event.preventDefault();
        onToggleViews();
        return;
      }
      if (modifier && event.shiftKey && key === "a") {
        event.preventDefault();
        onToggleArtifacts();
        return;
      }
      if (modifier && !event.shiftKey && key === "a") {
        event.preventDefault();
        onSelectAll();
        return;
      }
      if (modifier && !event.shiftKey && key === "d") {
        event.preventDefault();
        onDuplicate();
        return;
      }
      if (modifier && !event.shiftKey && key === "c") {
        event.preventDefault();
        onCopy();
        return;
      }
      if (modifier && !event.shiftKey && key === "v") {
        event.preventDefault();
        onPaste();
        return;
      }
      if (modifier && !event.shiftKey && event.key === "0") {
        event.preventDefault();
        onResetView();
        return;
      }
      if (!modifier && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        onZoomIn();
        return;
      }
      if (!modifier && event.key === "-") {
        event.preventDefault();
        onZoomOut();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (selectedNodeIds.length > 0 && isCanvasDeleteTarget(event.target) && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        onDeleteSelection();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    artifactLibraryOpen,
    disabled,
    onCopy,
    onDeleteSelection,
    onDismiss,
    onDuplicate,
    onExitPresentation,
    onNextView,
    onPaste,
    onPreviousView,
    onRedo,
    onResetView,
    onSelectAll,
    onToggleArtifacts,
    onToggleViews,
    onUndo,
    onZoomIn,
    onZoomOut,
    presentationMode,
    selectedNodeIds,
  ]);
}
