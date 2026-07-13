import { useEffect } from "react";

interface UseCanvasShortcutsOptions {
  disabled: boolean;
  selectedNodeId: string;
  onDeleteNode: (nodeId: string) => void;
  onDismiss: () => void;
  onResetView: () => void;
  onToggleArtifacts: () => void;
  onToggleViews: () => void;
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
  selectedNodeId,
  onDeleteNode,
  onDismiss,
  onResetView,
  onToggleArtifacts,
  onToggleViews,
  onZoomIn,
  onZoomOut,
}: UseCanvasShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (disabled || isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

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
      if (selectedNodeId && isCanvasDeleteTarget(event.target) && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        onDeleteNode(selectedNodeId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    disabled,
    onDeleteNode,
    onDismiss,
    onResetView,
    onToggleArtifacts,
    onToggleViews,
    onZoomIn,
    onZoomOut,
    selectedNodeId,
  ]);
}
