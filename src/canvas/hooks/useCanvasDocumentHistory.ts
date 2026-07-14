import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { CanvasNode } from "../../artifacts/types";

const HISTORY_LIMIT = 100;

export interface CanvasDocumentSnapshot {
  nodes: CanvasNode[];
  selectedNodeIds: string[];
}

function resolveState<T>(update: SetStateAction<T>, current: T) {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

function sameNodes(first: CanvasNode[], second: CanvasNode[]) {
  return first === second || (
    first.length === second.length &&
    first.every((node, index) => node === second[index])
  );
}

function sameNodeValue(first: CanvasNode, second: CanvasNode) {
  return first === second || JSON.stringify(first) === JSON.stringify(second);
}

function keepExistingSelection(nodeIds: string[], nodes: CanvasNode[]) {
  const existingIds = new Set(nodes.map((node) => node.id));
  return [...new Set(nodeIds)].filter((id) => existingIds.has(id));
}

export function useCanvasDocumentHistory(initialNodes: CanvasNode[], initialSelectedNodeId: string) {
  const initialDocument = useRef<CanvasDocumentSnapshot>({
    nodes: initialNodes,
    selectedNodeIds: initialSelectedNodeId ? [initialSelectedNodeId] : [],
  });
  const [document, setDocument] = useState(initialDocument.current);
  const documentRef = useRef(initialDocument.current);
  const pastRef = useRef<CanvasDocumentSnapshot[]>([]);
  const futureRef = useRef<CanvasDocumentSnapshot[]>([]);
  const transactionRef = useRef<CanvasDocumentSnapshot | null>(null);
  const [, setHistoryVersion] = useState(0);

  const applyDocument = useCallback((next: CanvasDocumentSnapshot) => {
    const checked = {
      nodes: next.nodes,
      selectedNodeIds: keepExistingSelection(next.selectedNodeIds, next.nodes),
    };
    documentRef.current = checked;
    setDocument(checked);
  }, []);

  const refreshHistoryState = useCallback(() => {
    setHistoryVersion((current) => current + 1);
  }, []);

  const recordSnapshot = useCallback((snapshot: CanvasDocumentSnapshot) => {
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
    futureRef.current = [];
    refreshHistoryState();
  }, [refreshHistoryState]);

  const setNodes = useCallback((update: SetStateAction<CanvasNode[]>) => {
    const current = documentRef.current;
    const nodes = resolveState(update, current.nodes);
    if (nodes === current.nodes) return;
    applyDocument({ ...current, nodes });
  }, [applyDocument]);

  const setSelectedNodeIds = useCallback((update: SetStateAction<string[]>) => {
    const current = documentRef.current;
    const selectedNodeIds = resolveState(update, current.selectedNodeIds);
    applyDocument({ ...current, selectedNodeIds });
  }, [applyDocument]);

  const commitDocument = useCallback((update: (current: CanvasDocumentSnapshot) => CanvasDocumentSnapshot) => {
    const current = documentRef.current;
    const next = update(current);
    if (!sameNodes(current.nodes, next.nodes)) recordSnapshot(current);
    applyDocument(next);
  }, [applyDocument, recordSnapshot]);

  const commitExternalDocument = useCallback((
    baseline: CanvasDocumentSnapshot,
    next: CanvasDocumentSnapshot,
  ) => {
    const local = documentRef.current;
    const localById = new Map(local.nodes.map((node) => [node.id, node]));
    const externalById = new Map(baseline.nodes.map((node) => [node.id, node]));
    const externallyChanged = new Set<string>();
    const externallyAdded: CanvasNode[] = [];

    for (const localNode of local.nodes) {
      const externalNode = externalById.get(localNode.id);
      if (!externalNode || !sameNodeValue(localNode, externalNode)) externallyChanged.add(localNode.id);
    }
    for (const externalNode of baseline.nodes) {
      if (!localById.has(externalNode.id)) externallyAdded.push(externalNode);
    }

    const rebase = (snapshot: CanvasDocumentSnapshot): CanvasDocumentSnapshot => {
      const nodes = snapshot.nodes.flatMap((node) => {
        if (!externallyChanged.has(node.id)) return [node];
        const externalNode = externalById.get(node.id);
        return externalNode ? [externalNode] : [];
      });
      const existingIds = new Set(nodes.map((node) => node.id));
      for (const node of externallyAdded) {
        if (!existingIds.has(node.id)) nodes.push(node);
      }
      return {
        nodes,
        selectedNodeIds: keepExistingSelection(snapshot.selectedNodeIds, nodes),
      };
    };

    transactionRef.current = null;
    pastRef.current = [
      ...pastRef.current.map(rebase).slice(-(HISTORY_LIMIT - 1)),
      {
        nodes: baseline.nodes,
        selectedNodeIds: keepExistingSelection(baseline.selectedNodeIds, baseline.nodes),
      },
    ];
    futureRef.current = [];
    applyDocument(next);
    refreshHistoryState();
  }, [applyDocument, refreshHistoryState]);

  const beginTransaction = useCallback(() => {
    transactionRef.current ??= documentRef.current;
  }, []);

  const commitTransaction = useCallback(() => {
    const before = transactionRef.current;
    transactionRef.current = null;
    if (before && !sameNodes(before.nodes, documentRef.current.nodes)) {
      recordSnapshot(before);
    }
  }, [recordSnapshot]);

  const resetDocument = useCallback((nodes: CanvasNode[], selectedNodeId = "") => {
    transactionRef.current = null;
    pastRef.current = [];
    futureRef.current = [];
    applyDocument({ nodes, selectedNodeIds: selectedNodeId ? [selectedNodeId] : [] });
    refreshHistoryState();
  }, [applyDocument, refreshHistoryState]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return false;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [documentRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    transactionRef.current = null;
    applyDocument(previous);
    refreshHistoryState();
    return true;
  }, [applyDocument, refreshHistoryState]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return false;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), documentRef.current];
    transactionRef.current = null;
    applyDocument(next);
    refreshHistoryState();
    return true;
  }, [applyDocument, refreshHistoryState]);

  return {
    beginTransaction,
    canRedo: futureRef.current.length > 0,
    canUndo: pastRef.current.length > 0,
    commitDocument,
    commitExternalDocument,
    commitTransaction,
    nodes: document.nodes,
    redo,
    resetDocument,
    selectedNodeIds: document.selectedNodeIds,
    setNodes,
    setSelectedNodeIds,
    undo,
  };
}
