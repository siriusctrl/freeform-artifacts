import { useRef, type SetStateAction } from "react";
import type { CanvasNode } from "../../artifacts/types";
import { CANVAS_GRID_SIZE } from "../../lib/geometry";
import {
  cloneCanvasNodes,
  cloneSelectedNodes,
  layoutSelection,
  type LayoutAction,
} from "../selection";
import type { CanvasDocumentSnapshot } from "./useCanvasDocumentHistory";

interface UseCanvasSelectionActionsOptions {
  commitDocument: (update: (current: CanvasDocumentSnapshot) => CanvasDocumentSnapshot) => void;
  nodes: CanvasNode[];
  redo: () => boolean;
  selectedNodeIds: string[];
  setSelectedNodeIds: (update: SetStateAction<string[]>) => void;
  setStatus: (status: string) => void;
  undo: () => boolean;
}

function artifactCountLabel(count: number) {
  return `${count} artifact${count === 1 ? "" : "s"}`;
}

export function useCanvasSelectionActions({
  commitDocument,
  nodes,
  redo,
  selectedNodeIds,
  setSelectedNodeIds,
  setStatus,
  undo,
}: UseCanvasSelectionActionsOptions) {
  const clipboardRef = useRef<CanvasNode[]>([]);
  const pasteCountRef = useRef(1);

  function deleteNode(nodeId: string) {
    commitDocument((current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      selectedNodeIds: current.selectedNodeIds.filter((id) => id !== nodeId),
    }));
  }

  function deleteSelection() {
    if (selectedNodeIds.length === 0) return;
    const selectedIds = new Set(selectedNodeIds);
    commitDocument((current) => ({
      nodes: current.nodes.filter((node) => !selectedIds.has(node.id)),
      selectedNodeIds: [],
    }));
    setStatus(`Deleted ${artifactCountLabel(selectedNodeIds.length)}`);
  }

  function duplicateSelection() {
    if (selectedNodeIds.length === 0) return;
    commitDocument((current) => {
      const duplicates = cloneSelectedNodes(current.nodes, current.selectedNodeIds);
      return {
        nodes: [...current.nodes, ...duplicates],
        selectedNodeIds: duplicates.map((node) => node.id),
      };
    });
    setStatus(`Duplicated ${artifactCountLabel(selectedNodeIds.length)}`);
  }

  function copySelection() {
    if (selectedNodeIds.length === 0) return;
    const selectedIds = new Set(selectedNodeIds);
    clipboardRef.current = nodes
      .filter((node) => selectedIds.has(node.id))
      .sort((first, second) => first.zIndex - second.zIndex)
      .map((node) => structuredClone(node));
    pasteCountRef.current = 1;
    setStatus(`Copied ${artifactCountLabel(clipboardRef.current.length)}`);
  }

  function pasteSelection() {
    if (clipboardRef.current.length === 0) return;
    commitDocument((current) => {
      const copies = cloneCanvasNodes(
        clipboardRef.current,
        current.nodes,
        CANVAS_GRID_SIZE * pasteCountRef.current,
      );
      return {
        nodes: [...current.nodes, ...copies],
        selectedNodeIds: copies.map((node) => node.id),
      };
    });
    pasteCountRef.current += 1;
    setStatus(`Pasted ${artifactCountLabel(clipboardRef.current.length)}`);
  }

  function applySelectionLayout(action: LayoutAction) {
    commitDocument((current) => ({
      ...current,
      nodes: layoutSelection(current.nodes, current.selectedNodeIds, action),
    }));
    setStatus("Selection aligned");
  }

  function undoChange() {
    if (undo()) setStatus("Undid last change");
  }

  function redoChange() {
    if (redo()) setStatus("Redid last change");
  }

  return {
    applySelectionLayout,
    copySelection,
    deleteNode,
    deleteSelection,
    duplicateSelection,
    pasteSelection,
    redoChange,
    selectAll: () => setSelectedNodeIds(nodes.map((node) => node.id)),
    undoChange,
  };
}
