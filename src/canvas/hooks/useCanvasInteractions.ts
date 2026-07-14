import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import type { CanvasNode, CanvasViewport } from "../../artifacts/types";
import { clientToStage, screenToWorld, snapToGrid, zoomAt } from "../../lib/geometry";
import { INITIAL_VIEWPORT } from "../constants";
import { resizeNodeToArtifactAspect } from "../nodeSize";
import {
  bringSelectionToFront,
  nodesIntersectingRect,
  normalizedSelectionRect,
  type SelectionRect,
} from "../selection";

interface NodeOrigin {
  id: string;
  x: number;
  y: number;
}

type DragState =
  | { type: "pan"; startX: number; startY: number; viewport: CanvasViewport }
  | {
      type: "node";
      anchorNodeId: string;
      nodeOrigins: NodeOrigin[];
      hasMoved: boolean;
      startWorldX: number;
      startWorldY: number;
    }
  | {
      type: "resize";
      nodeId: string;
      hasResized: boolean;
      startWorldX: number;
      startWorldY: number;
      startWidth: number;
      startHeight: number;
    }
  | {
      type: "marquee";
      startWorldX: number;
      startWorldY: number;
      initialSelection: string[];
    };

const WHEEL_LINE_HEIGHT = 16;
const PINCH_ZOOM_SENSITIVITY = 0.014;

function wheelDeltaScale(event: WheelEvent, pageHeight: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return WHEEL_LINE_HEIGHT;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return pageHeight;
  return 1;
}

interface UseCanvasInteractionsOptions {
  artifactRegistry: Record<string, RegisteredArtifact>;
  disabled?: boolean;
  nodes: CanvasNode[];
  onMutationCommit: () => void;
  onMutationStart: () => void;
  selectedNodeIds: string[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  snapToGrid: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewport;
}

export function useCanvasInteractions({
  artifactRegistry,
  disabled = false,
  nodes,
  onMutationCommit,
  onMutationStart,
  selectedNodeIds,
  setNodes,
  setSelectedNodeIds,
  setViewport,
  snapToGrid: shouldSnapToGrid,
  stageRef,
  viewport,
}: UseCanvasInteractionsOptions) {
  const dragRef = useRef<DragState | null>(null);
  const nodesRef = useRef(nodes);
  const [activeDragType, setActiveDragType] = useState<DragState["type"] | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  nodesRef.current = nodes;

  const pointerWorldPosition = useCallback(
    (clientX: number, clientY: number, targetViewport = viewport) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const stagePoint = rect
        ? clientToStage({ x: clientX, y: clientY }, rect)
        : { x: clientX, y: clientY };
      return screenToWorld(stagePoint, targetViewport);
    },
    [stageRef, viewport],
  );

  const updateNodePositions = useCallback(
    (drag: Extract<DragState, { type: "node" }>, world: { x: number; y: number }) => {
      const anchor = drag.nodeOrigins.find((origin) => origin.id === drag.anchorNodeId);
      if (!anchor) return;
      const rawAnchorX = anchor.x + world.x - drag.startWorldX;
      const rawAnchorY = anchor.y + world.y - drag.startWorldY;
      const nextAnchorX = shouldSnapToGrid ? snapToGrid(rawAnchorX) : Math.round(rawAnchorX);
      const nextAnchorY = shouldSnapToGrid ? snapToGrid(rawAnchorY) : Math.round(rawAnchorY);
      const deltaX = nextAnchorX - anchor.x;
      const deltaY = nextAnchorY - anchor.y;
      if (deltaX === 0 && deltaY === 0) return;
      const origins = new Map(drag.nodeOrigins.map((origin) => [origin.id, origin]));
      const firstMove = !drag.hasMoved;
      drag.hasMoved = true;
      setNodes((current) => {
        const moved = current.map((node) => {
          const origin = origins.get(node.id);
          return origin ? { ...node, x: origin.x + deltaX, y: origin.y + deltaY } : node;
        });
        return firstMove ? bringSelectionToFront(moved, drag.nodeOrigins.map((origin) => origin.id)) : moved;
      });
    },
    [setNodes, shouldSnapToGrid],
  );

  const updateNodeSize = useCallback(
    (drag: Extract<DragState, { type: "resize" }>, width: number, height: number) => {
      const node = nodesRef.current.find((candidate) => candidate.id === drag.nodeId);
      if (!node) return;
      const size = resizeNodeToArtifactAspect(artifactRegistry[node.artifactId], width, height);
      if (size.width === node.width && size.height === node.height) return;
      const firstResize = !drag.hasResized;
      drag.hasResized = true;
      setNodes((current) => {
        const resized = current.map((candidate) => candidate.id === drag.nodeId
          ? { ...candidate, ...size }
          : candidate);
        return firstResize ? bringSelectionToFront(resized, [drag.nodeId]) : resized;
      });
    },
    [artifactRegistry, setNodes],
  );

  const startDrag = useCallback((nextDrag: DragState) => {
    dragRef.current = nextDrag;
    setActiveDragType(nextDrag.type);
  }, []);

  const endDrag = useCallback(() => {
    const currentDrag = dragRef.current;
    dragRef.current = null;
    setActiveDragType(null);
    setSelectionRect(null);
    if (currentDrag?.type === "node" || currentDrag?.type === "resize") {
      onMutationCommit();
    }
  }, [onMutationCommit]);

  useEffect(() => {
    if (disabled && dragRef.current) endDrag();
  }, [disabled, endDrag]);

  useEffect(() => {
    document.body.classList.toggle("dragging-canvas", Boolean(activeDragType));
    return () => document.body.classList.remove("dragging-canvas");
  }, [activeDragType]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const currentDrag = dragRef.current;
      if (!currentDrag) return;
      event.preventDefault();

      if (currentDrag.type === "pan") {
        setViewport({
          ...currentDrag.viewport,
          x: currentDrag.viewport.x + event.clientX - currentDrag.startX,
          y: currentDrag.viewport.y + event.clientY - currentDrag.startY,
        });
        return;
      }

      const world = pointerWorldPosition(event.clientX, event.clientY);
      if (currentDrag.type === "resize") {
        updateNodeSize(
          currentDrag,
          currentDrag.startWidth + world.x - currentDrag.startWorldX,
          currentDrag.startHeight + world.y - currentDrag.startWorldY,
        );
        return;
      }

      if (currentDrag.type === "node") {
        updateNodePositions(currentDrag, world);
        return;
      }

      const rect = normalizedSelectionRect(
        { x: currentDrag.startWorldX, y: currentDrag.startWorldY },
        world,
      );
      setSelectionRect(rect);
      const matches = nodesIntersectingRect(nodesRef.current, rect);
      setSelectedNodeIds([...new Set([...currentDrag.initialSelection, ...matches])]);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag, pointerWorldPosition, setSelectedNodeIds, setViewport, updateNodePositions, updateNodeSize]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || disabled) return;
    const pageHeight = stage.clientHeight;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const deltaScale = wheelDeltaScale(event, pageHeight);
      const deltaX = event.deltaX * deltaScale;
      const deltaY = event.deltaY * deltaScale;

      if (event.ctrlKey) {
        const zoomFactor = Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY);
        const stagePoint = clientToStage(
          { x: event.clientX, y: event.clientY },
          stage!.getBoundingClientRect(),
        );
        setViewport((current) => zoomAt(current, stagePoint, current.scale * zoomFactor));
        return;
      }

      setViewport((current) => ({ ...current, x: current.x - deltaX, y: current.y - deltaY }));
    }

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [disabled, setViewport, stageRef]);

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.button !== 0 || target?.closest(".canvas-node, button, a, input, textarea, select")) return;

      event.preventDefault();
      stageRef.current?.focus({ preventScroll: true });
      if (event.shiftKey) {
        const world = pointerWorldPosition(event.clientX, event.clientY);
        setSelectionRect({ x: world.x, y: world.y, width: 0, height: 0 });
        startDrag({
          type: "marquee",
          startWorldX: world.x,
          startWorldY: world.y,
          initialSelection: selectedNodeIds,
        });
        return;
      }

      setSelectedNodeIds([]);
      startDrag({ type: "pan", startX: event.clientX, startY: event.clientY, viewport });
    },
    [disabled, pointerWorldPosition, selectedNodeIds, setSelectedNodeIds, stageRef, startDrag, viewport],
  );

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      stageRef.current?.focus({ preventScroll: true });

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const alreadySelected = selectedNodeIds.includes(node.id);
      if (additive && alreadySelected) {
        setSelectedNodeIds(selectedNodeIds.filter((id) => id !== node.id));
        return;
      }

      const nextSelection = additive
        ? [...selectedNodeIds, node.id]
        : alreadySelected
          ? selectedNodeIds
          : [node.id];
      const world = pointerWorldPosition(event.clientX, event.clientY);
      const selectedSet = new Set(nextSelection);
      const nodeOrigins = nodes
        .filter((candidate) => selectedSet.has(candidate.id))
        .map((candidate) => ({ id: candidate.id, x: candidate.x, y: candidate.y }));
      onMutationStart();
      setSelectedNodeIds(nextSelection);
      startDrag({
        type: "node",
        anchorNodeId: node.id,
        hasMoved: false,
        nodeOrigins,
        startWorldX: world.x,
        startWorldY: world.y,
      });
    },
    [disabled, nodes, onMutationStart, pointerWorldPosition, selectedNodeIds, setSelectedNodeIds, stageRef, startDrag],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const world = pointerWorldPosition(event.clientX, event.clientY);
      onMutationStart();
      setSelectedNodeIds([node.id]);
      startDrag({
        type: "resize",
        hasResized: false,
        nodeId: node.id,
        startWorldX: world.x,
        startWorldY: world.y,
        startWidth: node.width,
        startHeight: node.height,
      });
    },
    [disabled, onMutationStart, pointerWorldPosition, setSelectedNodeIds, startDrag],
  );

  const changeZoom = useCallback((factor: number) => {
    if (disabled) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.width / 2, y: rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setViewport((current) => zoomAt(current, center, current.scale * factor));
  }, [disabled, setViewport, stageRef]);

  const resetView = useCallback(() => {
    if (!disabled) setViewport(INITIAL_VIEWPORT);
  }, [disabled, setViewport]);

  return {
    changeZoom,
    handleNodePointerDown,
    handleResizePointerDown,
    handleStagePointerDown,
    resetView,
    selectionRect,
  };
}
