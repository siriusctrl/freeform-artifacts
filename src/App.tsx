import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadInstalledArtifacts } from "./artifacts/generated/bundles";
import { artifactRegistry } from "./artifacts/registry";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import { AsyncMutationGate } from "./relay/asyncMutationGate";
import {
  installPreparedRelayDeliveryIntoStoredView,
  prepareRelayArtifacts,
  RelayDeliveryRejectedError,
} from "./relay/installDelivery";
import type { RelayDeliveryIdentity, RelayLiveInstaller, RelaySessionRequest } from "./relay/types";
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
  const [externalMutationBusy, setExternalMutationBusy] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const liveRelayInstallerRef = useRef<RelayLiveInstaller | null>(null);
  const viewMutationGate = useRef(new AsyncMutationGate()).current;
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
    placement: RelaySessionRequest,
    identity: RelayDeliveryIdentity,
  ) => {
    const targetViewIncarnationId = placement.targetViewIncarnationId;
    const resultFromReceipt = (receipt: Awaited<ReturnType<typeof loadRelayInstallReceipt>>) => {
      if (!receipt) return null;
      if (
        receipt.targetViewId !== targetViewId ||
        receipt.targetViewIncarnationId !== targetViewIncarnationId
      ) {
        throw new RelayDeliveryRejectedError("Relay receipt target does not match this Build Session");
      }
      return { artifactIds: receipt.artifactIds, nodeIds: receipt.nodeIds };
    };
    const existingResult = resultFromReceipt(
      await loadRelayInstallReceipt(identity.sessionId, identity.deliveryId),
    );
    if (existingResult) return existingResult;
    if (!navigator.locks?.request) {
      throw new RelayDeliveryRejectedError(
        "This browser cannot safely install cross-tab Build Session deliveries. Use file install instead.",
      );
    }

    // Trusted bundle module evaluation can be unbounded. Keep it outside the
    // short mutation gate so navigation and the canvas never become inert while
    // the browser validates the complete selection.
    const installed = await loadInstalledArtifacts();
    const preparedArtifacts = await prepareRelayArtifacts(
      bundles,
      { ...artifactRegistry, ...installed.registry },
    );
    if (identity.signal.aborted) {
      throw new DOMException("Build Session is no longer active", "AbortError");
    }

    const result = await viewMutationGate.runExclusive(async () => {
      setExternalMutationBusy(true);
      try {
        const racedBeforeCommit = resultFromReceipt(
          await loadRelayInstallReceipt(identity.sessionId, identity.deliveryId),
        );
        if (racedBeforeCommit) return racedBeforeCommit;
        const liveInstaller = liveRelayInstallerRef.current;
        let result;
        try {
          if (
            liveInstaller?.viewId === targetViewId &&
            liveInstaller.viewIncarnationId === targetViewIncarnationId
          ) {
            result = await liveInstaller.install(preparedArtifacts, placement, identity);
          } else {
            const prepared = await installPreparedRelayDeliveryIntoStoredView(
              targetViewId,
              targetViewIncarnationId,
              preparedArtifacts,
              placement,
              identity,
            );
            result = {
              artifactIds: prepared.artifacts.map((artifact) => artifact.id),
              nodeIds: prepared.nodes.map((node) => node.id),
            };
            liveInstaller?.syncArtifactCatalog(preparedArtifacts);
            if (requestedViewId.current === targetViewId) {
              setBootstrapped({
                template,
                result: { source: "existing", storage: "indexeddb", workspace: prepared.workspace },
              });
              setCanvasEpoch((current) => current + 1);
            }
          }
        } catch (error) {
          if (!(error instanceof RelayReceiptAlreadyExistsError)) throw error;
          const racedReceipt = resultFromReceipt(
            await loadRelayInstallReceipt(identity.sessionId, identity.deliveryId),
          );
          if (!racedReceipt) throw error;
          result = racedReceipt;
        }
        return result;
      } finally {
        setExternalMutationBusy(false);
      }
    });
    void listWorkspaces().then(setViews).catch(() => undefined);
    return result;
  }, [template, viewMutationGate]);
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

  async function selectViewUnlocked(id: string) {
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

  function selectView(id: string) {
    return viewMutationGate.runExclusive(() => selectViewUnlocked(id));
  }

  function addView() {
    return viewMutationGate.runExclusive(async () => {
      const result = await createWorkspace(template);
      viewRequestVersion.current += 1;
      requestedViewId.current = result.workspace.templateId;
      setViews(await listWorkspaces());
      setBootstrapped({ template, result });
    });
  }

  function copyView(id: string, currentWorkspace?: WorkspaceRecord) {
    return viewMutationGate.runExclusive(async () => {
      const result = await duplicateWorkspace(id, currentWorkspace);
      viewRequestVersion.current += 1;
      requestedViewId.current = result.workspace.templateId;
      setViews(await listWorkspaces());
      setBootstrapped({ template, result });
    });
  }

  function removeView(id: string, currentWorkspace?: WorkspaceRecord) {
    return viewMutationGate.runExclusive(async () => {
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
          if (nextView && await selectViewUnlocked(nextView.id)) {
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
    });
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

  function undoViewDeletion() {
    return viewMutationGate.runExclusive(async () => {
      if (!deletedView) return;
      try {
        await restoreWorkspace(deletedView.workspace, deletedView.index, deletedView.deletionId);
        setViews(await listWorkspaces());
        setDeletedView(null);
        setViewUndoError("");
      } catch (error) {
        setViewUndoError(error instanceof Error ? error.message : "Unable to restore this canvas");
      }
    });
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
      void viewMutationGate.runExclusive(async () => {
        let currentViews = await listWorkspaces();
        setViews(currentViews);
        const activeViewId = requestedViewId.current || bootstrapped?.result.workspace.templateId || "";
        const activeView = currentViews.find((view) => view.id === activeViewId);
        const mountedWorkspace = bootstrapped?.result.workspace;
        if (
          activeView &&
          mountedWorkspace?.templateId === activeView.id &&
          mountedWorkspace.incarnationId === activeView.incarnationId
        ) return;
        if (activeView && await selectViewUnlocked(activeView.id)) return;
        for (let attempt = 0; attempt < 2 && currentViews.length > 0; attempt += 1) {
          if (await selectViewUnlocked(currentViews[0].id)) return;
          currentViews = await listWorkspaces();
          setViews(currentViews);
        }
        const result = await createWorkspace(template);
        viewRequestVersion.current += 1;
        requestedViewId.current = result.workspace.templateId;
        setBootstrapped({ template, result });
        setViews(await listWorkspaces());
      }).catch((error) => {
        setBootstrapError(error instanceof Error ? error.message : "Unable to reconcile local canvases");
      });
    };
    window.addEventListener("storage", reconcileDeletedViews);
    return () => window.removeEventListener("storage", reconcileDeletedViews);
  }, [
    bootstrapped?.result.workspace.incarnationId,
    bootstrapped?.result.workspace.templateId,
    template,
    viewMutationGate,
  ]);

  function navigatePresentation(direction: -1 | 1) {
    void viewMutationGate.runExclusive(async () => {
      const activeId = requestedViewId.current || bootstrapped?.result.workspace.templateId;
      const activeIndex = views.findIndex((view) => view.id === activeId);
      if (activeIndex < 0 || views.length < 2) return;
      const nextIndex = (activeIndex + direction + views.length) % views.length;
      await selectViewUnlocked(views[nextIndex].id);
    });
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
        key={`${bootstrapped.result.workspace.templateId}:${bootstrapped.result.workspace.incarnationId}:${canvasEpoch}`}
        externalMutationBusy={externalMutationBusy}
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
