import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import {
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  listWorkspaces,
  loadOrCreateWorkspace,
  loadWorkspaceById,
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
  const [presentationMode, setPresentationMode] = useState(false);
  const [deletedView, setDeletedView] = useState<DeletedView | null>(null);
  const requestedViewId = useRef("");
  const viewRequestVersion = useRef(0);
  const template = useMemo(() => getRequestedTemplate(), []);

  useEffect(() => {
    let cancelled = false;
    loadOrCreateWorkspace(template)
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

  async function selectView(id: string) {
    const requestVersion = viewRequestVersion.current + 1;
    viewRequestVersion.current = requestVersion;
    requestedViewId.current = id;
    const result = await loadWorkspaceById(id);
    if (requestVersion !== viewRequestVersion.current) return;
    if (!result) {
      requestedViewId.current = bootstrapped?.result.workspace.templateId ?? "";
      return;
    }
    setActiveWorkspaceId(id);
    setBootstrapped({ template, result });
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
    const remaining = views.filter((view) => view.id !== id);
    const removed = await deleteWorkspace(id, currentWorkspace);
    if (!removed) return;
    setDeletedView({ workspace: removed, index: Math.max(0, index) });
    setViews(remaining);
    if (bootstrapped?.result.workspace.templateId === id) {
      const nextView = remaining[Math.min(Math.max(0, index), remaining.length - 1)];
      if (nextView) await selectView(nextView.id);
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
    await restoreWorkspace(deletedView.workspace, deletedView.index);
    setViews(await listWorkspaces());
    setDeletedView(null);
  }

  function updateViewTitle(id: string, title: string) {
    setViews((current) => current.map((view) => view.id === id ? { ...view, title } : view));
  }

  async function toggleSidebar() {
    const opening = !sidebarOpen;
    setSidebarOpen(opening);
    if (opening) setViews(await listWorkspaces());
  }

  function navigatePresentation(direction: -1 | 1) {
    const activeId = requestedViewId.current || bootstrapped?.result.workspace.templateId;
    const activeIndex = views.findIndex((view) => view.id === activeId);
    if (activeIndex < 0 || views.length < 2) return;
    const nextIndex = (activeIndex + direction + views.length) % views.length;
    void selectView(views[nextIndex].id);
  }

  useEffect(() => {
    if (!deletedView) return;
    const timer = window.setTimeout(() => setDeletedView(null), 6500);
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
        onCreateView={addView}
        onDeleteView={removeView}
        onDuplicateView={copyView}
        onEnterPresentation={() => {
          setSidebarOpen(false);
          setPresentationMode(true);
        }}
        onExitPresentation={() => setPresentationMode(false)}
        onNextPresentationView={() => navigatePresentation(1)}
        onPreviousPresentationView={() => navigatePresentation(-1)}
        onReorderView={reorderView}
        onSelectView={selectView}
        onToggleSidebar={toggleSidebar}
        onViewTitleChange={updateViewTitle}
      />
      {deletedView ? (
        <div className="view-undo-toast" role="status" data-testid="view-undo-toast">
          <span>Deleted {deletedView.workspace.title}</span>
          <button type="button" onClick={() => void undoViewDeletion()}>Undo</button>
        </div>
      ) : null}
    </>
  );
}
