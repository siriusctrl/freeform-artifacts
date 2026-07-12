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
import type { CanvasNode, CanvasViewport } from "../../artifacts/types";
import type { RegisteredArtifact } from "../../artifacts/registryTypes";
import { INITIAL_VIEWPORT } from "../constants";
import { resizeNodeToArtifactAspect } from "../nodeSize";
import { clientToStage, screenToWorld, snapToGrid, zoomAt } from "../../lib/geometry";

type DragState =
  | { type: "pan"; startX: number; startY: number; viewport: CanvasViewport }
  | { type: "node"; nodeId: string; startWorldX: number; startWorldY: number; nodeX: number; nodeY: number }
  | {
      type: "resize";
      nodeId: string;
      startWorldX: number;
      startWorldY: number;
      startWidth: number;
      startHeight: number;
    };

const WHEEL_LINE_HEIGHT = 16;
const PINCH_ZOOM_SENSITIVITY = 0.014;

function wheelDeltaScale(event: WheelEvent, pageHeight: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return WHEEL_LINE_HEIGHT;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return pageHeight;
  }

  return 1;
}

interface UseCanvasInteractionsOptions {
  artifactRegistry: Record<string, RegisteredArtifact>;
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewport;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setSelectedNodeId: Dispatch<SetStateAction<string>>;
  snapToGrid: boolean;
}

export function useCanvasInteractions({
  artifactRegistry,
  stageRef,
  viewport,
  setViewport,
  setNodes,
  setSelectedNodeId,
  snapToGrid: shouldSnapToGrid,
}: UseCanvasInteractionsOptions) {
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

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

  const updateNodePosition = useCallback(
    (nodeId: string, x: number, y: number) => {
      const nextX = shouldSnapToGrid ? snapToGrid(x) : Math.round(x);
      const nextY = shouldSnapToGrid ? snapToGrid(y) : Math.round(y);
      setNodes((current) =>
        current.map((node) => (node.id === nodeId ? { ...node, x: nextX, y: nextY } : node)),
      );
    },
    [setNodes, shouldSnapToGrid],
  );

  const updateNodeSize = useCallback(
    (nodeId: string, width: number, height: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }

          const nextSize = resizeNodeToArtifactAspect(
            artifactRegistry[node.artifactId],
            width,
            height,
          );

          return {
            ...node,
            ...nextSize,
          };
        }),
      );
    },
    [artifactRegistry, setNodes],
  );

  const bringToFront = useCallback(
    (nodeId: string) => {
      setNodes((current) => {
        const maxZ = Math.max(...current.map((node) => node.zIndex));
        return current.map((node) => (node.id === nodeId ? { ...node, zIndex: maxZ + 1 } : node));
      });
    },
    [setNodes],
  );

  const startDrag = useCallback((nextDrag: DragState) => {
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    dragRef.current = drag;
    document.body.classList.toggle("dragging-canvas", Boolean(drag));

    return () => {
      if (!dragRef.current) {
        document.body.classList.remove("dragging-canvas");
      }
    };
  }, [drag]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const currentDrag = dragRef.current;
      if (!currentDrag) {
        return;
      }

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
          currentDrag.nodeId,
          currentDrag.startWidth + world.x - currentDrag.startWorldX,
          currentDrag.startHeight + world.y - currentDrag.startWorldY,
        );
        return;
      }

      updateNodePosition(
        currentDrag.nodeId,
        currentDrag.nodeX + world.x - currentDrag.startWorldX,
        currentDrag.nodeY + world.y - currentDrag.startWorldY,
      );
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag, pointerWorldPosition, setViewport, updateNodePosition, updateNodeSize]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stageElement = stage;
    const pageHeight = stageElement.clientHeight;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const deltaScale = wheelDeltaScale(event, pageHeight);
      const deltaX = event.deltaX * deltaScale;
      const deltaY = event.deltaY * deltaScale;

      if (event.ctrlKey) {
        const zoomFactor = Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY);
        const stagePoint = clientToStage(
          { x: event.clientX, y: event.clientY },
          stageElement.getBoundingClientRect(),
        );
        setViewport((current) => zoomAt(current, stagePoint, current.scale * zoomFactor));
        return;
      }

      setViewport((current) => ({
        ...current,
        x: current.x - deltaX,
        y: current.y - deltaY,
      }));
    }

    stageElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      stageElement.removeEventListener("wheel", handleWheel);
    };
  }, [setViewport, stageRef]);

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.button !== 0 || target?.closest(".canvas-node, button, a, input, textarea, select")) {
        return;
      }

      event.preventDefault();
      setSelectedNodeId("");
      startDrag({
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        viewport,
      });
    },
    [setSelectedNodeId, startDrag, viewport],
  );

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const world = pointerWorldPosition(event.clientX, event.clientY);
      setSelectedNodeId(node.id);
      bringToFront(node.id);
      startDrag({
        type: "node",
        nodeId: node.id,
        startWorldX: world.x,
        startWorldY: world.y,
        nodeX: node.x,
        nodeY: node.y,
      });
    },
    [bringToFront, pointerWorldPosition, setSelectedNodeId, startDrag],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const world = pointerWorldPosition(event.clientX, event.clientY);
      setSelectedNodeId(node.id);
      bringToFront(node.id);
      startDrag({
        type: "resize",
        nodeId: node.id,
        startWorldX: world.x,
        startWorldY: world.y,
        startWidth: node.width,
        startHeight: node.height,
      });
    },
    [bringToFront, pointerWorldPosition, setSelectedNodeId, startDrag],
  );

  const changeZoom = useCallback(
    (factor: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const center = rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      setViewport((current) => zoomAt(current, center, current.scale * factor));
    },
    [setViewport, stageRef],
  );

  const resetView = useCallback(() => {
    setViewport(INITIAL_VIEWPORT);
  }, [setViewport]);

  return {
    changeZoom,
    handleNodePointerDown,
    handleResizePointerDown,
    handleStagePointerDown,
    resetView,
  };
}
