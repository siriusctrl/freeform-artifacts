import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import { installRelayDeliveryIntoStoredView } from "./relay/installDelivery";
import type { RelayDeliveryIdentity, RelayLiveInstaller } from "./relay/types";
import { useArtifactRelaySession } from "./relay/useArtifactRelaySession";
import {
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  listWorkspaces,
  loadOrCreateWorkspace,
  loadRelayInstallReceipt,
  loadWorkspaceById,
  RelayReceiptAlreadyExistsError,
  reorderWorkspaces,
  restoreWorkspace,
  setActiveWorkspaceId,
} from "./workspaces/storage";
import { getRequestedTemplate } from "./workspaces/templates";
import type { WorkspaceLoadResult, WorkspaceRecord, WorkspaceSummary, WorkspaceTemplate } from "./workspaces/types";

interface BootstrappedWorkspace {
  template: WorkspaceTemplate;
  result: WorkspaceLoadResult;
}

interface DeletedView {
  deletionId: string;
  index: number;
  workspace: WorkspaceRecord;
}

function statusForLoad(result: WorkspaceLoadResult) {
  if (result.source === "existing") return "Local workspace restored";
  if (result.source === "legacy") return "Previous board migrated";
  return "Demo copied to this browser";
}

export default function App() {
  const [bootstrapped, setBootstrapped] = useState<BootstrappedWorkspace | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [views, setViews] = useState<WorkspaceSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const liveRelayInstallerRef = useRef<RelayLiveInstaller | null>(null);
  const previousMountedViewId = useRef("");
  const undoButtonRef = useRef<HTMLButtonElement | null>(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [deletedView, setDeletedView] = useState<DeletedView | null>(null);
  const [viewUndoError, setViewUndoError] = useState("");
  const requestedViewId = useRef("");
  const viewRequestVersion = useRef(0);
  const bootstrapPromise = useRef<Promise<WorkspaceLoadResult> | null>(null);
  const template = useMemo(() => getRequestedTemplate(), []);

  const installRelayDelivery = useCallback(async (
    targetViewId: string,
    bundles: unknown[],
    placement: { stageSize: { width: number; height: number } },
    identity: RelayDeliveryIdentity,
  ) => {
    const receipt = await loadRelayInstallReceipt(identity.sessionId, identity.deliveryId);
    if (receipt) {
      if (receipt.targetViewId !== targetViewId) throw new Error("Relay receipt target does not match this session");
      await liveRelayInstallerRef.current?.refreshArtifacts();
      return { artifactIds: receipt.artifactIds, nodeIds: receipt.nodeIds };
    }
    const liveInstaller = liveRelayInstallerRef.current;
    let result;
    try {
      result = liveInstaller?.viewId === targetViewId
        ? await liveInstaller.install(bundles, placement, identity)
        : await installRelayDeliveryIntoStoredView(targetViewId, bundles, placement, identity).then((prepared) => ({
          artifactIds: prepared.artifacts.map((artifact) => artifact.id),
          nodeIds: prepared.nodes.map((node) => node.id),
        }));
    } catch (error) {
      if (!(error instanceof RelayReceiptAlreadyExistsError)) throw error;
      const racedReceipt = await loadRelayInstallReceipt(identity.sessionId, identity.deliveryId);
      if (!racedReceipt || racedReceipt.targetViewId !== targetViewId) throw error;
      result = { artifactIds: racedReceipt.artifactIds, nodeIds: racedReceipt.nodeIds };
    }
    await liveRelayInstallerRef.current?.refreshArtifacts();
    setViews(await listWorkspaces());
    return result;
  }, []);
  const relay = useArtifactRelaySession(installRelayDelivery);
  const registerRelayInstaller = useCallback((installer: RelayLiveInstaller | null) => {
    liveRelayInstallerRef.current = installer;
  }, []);

  useEffect(() => {
    let cancelled = false;
    bootstrapPromise.current ??= loadOrCreateWorkspace(template);
    bootstrapPromise.current
      .then(async (result) => {
        const summaries = await listWorkspaces();
        if (!cancelled) {
          requestedViewId.current = result.workspace.templateId;
          setBootstrapped({ template, result });
          setViews(summaries);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : "Unable to open the local workspace");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [template]);

  useEffect(() => {
    const activeViewId = bootstrapped?.result.workspace.templateId ?? "";
    if (previousMountedViewId.current && previousMountedViewId.current !== activeViewId) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')?.focus({ preventScroll: true });
      });
    }
    previousMountedViewId.current = activeViewId;
  }, [bootstrapped?.result.workspace.templateId]);

  async function selectView(id: string) {
    const requestVersion = viewRequestVersion.current + 1;
    viewRequestVersion.current = requestVersion;
    requestedViewId.current = id;
    const result = await loadWorkspaceById(id);
    if (requestVersion !== viewRequestVersion.current) return false;
    if (!result) {
      requestedViewId.current = bootstrapped?.result.workspace.templateId ?? "";
      return false;
    }
    setActiveWorkspaceId(id);
    setBootstrapped({ template, result });
    return true;
  }

  async function addView() {
    const result = await createWorkspace(template);
    viewRequestVersion.current += 1;
    requestedViewId.current = result.workspace.templateId;
    setViews(await listWorkspaces());
    setBootstrapped({ template, result });
  }

  async function copyView(id: string, currentWorkspace?: WorkspaceRecord) {
    const result = await duplicateWorkspace(id, currentWorkspace);
    viewRequestVersion.current += 1;
    requestedViewId.current = result.workspace.templateId;
    setViews(await listWorkspaces());
    setBootstrapped({ template, result });
  }

  async function removeView(id: string, currentWorkspace?: WorkspaceRecord) {
    if (views.length <= 1) return;
    const index = views.findIndex((view) => view.id === id);
    const removed = await deleteWorkspace(id, currentWorkspace);
    if (!removed) return;
    setViewUndoError("");
    setDeletedView(removed.deletionId
      ? { deletionId: removed.deletionId, workspace: removed.workspace, index: Math.max(0, index) }
      : null);
    let remaining = await listWorkspaces();
    setViews(remaining);
    const activeViewId = bootstrapped?.result.workspace.templateId ?? "";
    if (!remaining.some((view) => view.id === activeViewId)) {
      let openedSurvivor = false;
      for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt += 1) {
        const nextView = remaining[Math.min(Math.max(0, index), remaining.length - 1)];
        if (nextView && await selectView(nextView.id)) {
          openedSurvivor = true;
          break;
        }
        remaining = await listWorkspaces();
        setViews(remaining);
      }
      if (!openedSurvivor) {
        const result = await createWorkspace(template);
        viewRequestVersion.current += 1;
        requestedViewId.current = result.workspace.templateId;
        setBootstrapped({ template, result });
        setViews(await listWorkspaces());
      }
    }
  }

  function reorderView(sourceId: string, targetId: string) {
    reorderWorkspaces(sourceId, targetId);
    setViews((current) => {
      const sourceIndex = current.findIndex((view) => view.id === sourceId);
      const targetIndex = current.findIndex((view) => view.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const movingDown = sourceIndex < targetIndex;
      const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      next.splice(next.findIndex((view) => view.id === targetId) + (movingDown ? 1 : 0), 0, source);
      return next;
    });
  }

  async function undoViewDeletion() {
    if (!deletedView) return;
    try {
      await restoreWorkspace(deletedView.workspace, deletedView.index, deletedView.deletionId);
      setViews(await listWorkspaces());
      setDeletedView(null);
      setViewUndoError("");
    } catch (error) {
      setViewUndoError(error instanceof Error ? error.message : "Unable to restore this canvas");
    }
  }

  function updateViewTitle(id: string, title: string) {
    setViews((current) => current.map((view) => view.id === id ? { ...view, title } : view));
  }

  async function toggleSidebar() {
    const opening = !sidebarOpen;
    setSidebarOpen(opening);
    if (opening) setViews(await listWorkspaces());
  }

  useEffect(() => {
    const reconcileDeletedViews = (event: StorageEvent) => {
      if (!event.key?.startsWith("freeform-artifacts.deleted-view")) return;
      void (async () => {
        let currentViews = await listWorkspaces();
        setViews(currentViews);
        const activeViewId = requestedViewId.current || bootstrapped?.result.workspace.templateId || "";
        if (currentViews.some((view) => view.id === activeViewId)) return;
        for (let attempt = 0; attempt < 2 && currentViews.length > 0; attempt += 1) {
          if (await selectView(currentViews[0].id)) return;
          currentViews = await listWorkspaces();
          setViews(currentViews);
        }
        const result = await createWorkspace(template);
        viewRequestVersion.current += 1;
        requestedViewId.current = result.workspace.templateId;
        setBootstrapped({ template, result });
        setViews(await listWorkspaces());
      })().catch((error) => {
        setBootstrapError(error instanceof Error ? error.message : "Unable to reconcile local canvases");
      });
    };
    window.addEventListener("storage", reconcileDeletedViews);
    return () => window.removeEventListener("storage", reconcileDeletedViews);
  }, [bootstrapped?.result.workspace.templateId, template]);

  function navigatePresentation(direction: -1 | 1) {
    const activeId = requestedViewId.current || bootstrapped?.result.workspace.templateId;
    const activeIndex = views.findIndex((view) => view.id === activeId);
    if (activeIndex < 0 || views.length < 2) return;
    const nextIndex = (activeIndex + direction + views.length) % views.length;
    void selectView(views[nextIndex].id);
  }

  useEffect(() => {
    if (!deletedView) return;
    window.requestAnimationFrame(() => undoButtonRef.current?.focus({ preventScroll: true }));
    const timer = window.setTimeout(() => setDeletedView(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [deletedView]);

  if (bootstrapError) {
    return (
      <main className="app-shell" data-theme="light">
        <section className="workspace-gate" role="alert">
          <strong>Workspace unavailable</strong>
          <p>{bootstrapError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </main>
    );
  }

  if (!bootstrapped) {
    return (
      <main className="app-shell" data-theme="light">
        <section className="workspace-gate" aria-live="polite">
          <strong>Opening your local workspace</strong>
          <p>The public demo stays untouched while this browser loads its own copy.</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <CanvasWorkspace
        key={bootstrapped.result.workspace.templateId}
        initialWorkspace={bootstrapped.result.workspace}
        initialStorage={bootstrapped.result.storage}
        initialStatus={statusForLoad(bootstrapped.result)}
        template={bootstrapped.template}
        views={views}
        sidebarOpen={sidebarOpen}
        presentationMode={presentationMode}
        relay={relay}
        onCreateView={addView}
        onDeleteView={removeView}
        onDuplicateView={copyView}
        onEnterPresentation={() => {
          setSidebarOpen(false);
          setPresentationMode(true);
        }}
        onExitPresentation={() => {
          setPresentationMode(false);
          window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')?.focus({ preventScroll: true });
          });
        }}
        onNextPresentationView={() => navigatePresentation(1)}
        onPreviousPresentationView={() => navigatePresentation(-1)}
        onReorderView={reorderView}
        onRegisterRelayInstaller={registerRelayInstaller}
        onSelectView={selectView}
        onToggleSidebar={toggleSidebar}
        onViewTitleChange={updateViewTitle}
      />
      {deletedView ? (
        <div className="view-undo-toast" role="status" data-testid="view-undo-toast">
          <span>{viewUndoError || `Deleted ${deletedView.workspace.title}`}</span>
          <button ref={undoButtonRef} type="button" onClick={() => void undoViewDeletion()}>Undo</button>
        </div>
      ) : null}
    </>
  );
}
