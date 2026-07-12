import { useEffect, useMemo, useState } from "react";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import {
  createWorkspace,
  listWorkspaces,
  loadOrCreateWorkspace,
  loadWorkspaceById,
  setActiveWorkspaceId,
} from "./workspaces/storage";
import { getRequestedTemplate } from "./workspaces/templates";
import type { WorkspaceLoadResult, WorkspaceSummary, WorkspaceTemplate } from "./workspaces/types";

interface BootstrappedWorkspace {
  template: WorkspaceTemplate;
  result: WorkspaceLoadResult;
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
  const template = useMemo(() => getRequestedTemplate(), []);

  useEffect(() => {
    let cancelled = false;
    loadOrCreateWorkspace(template)
      .then(async (result) => {
        const summaries = await listWorkspaces();
        if (!cancelled) {
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
    const result = await loadWorkspaceById(id);
    if (!result) return;
    setActiveWorkspaceId(id);
    setBootstrapped({ template, result });
  }

  async function addView() {
    const result = await createWorkspace(template);
    setViews(await listWorkspaces());
    setBootstrapped({ template, result });
  }

  function updateViewTitle(id: string, title: string) {
    setViews((current) => current.map((view) => view.id === id ? { ...view, title } : view));
  }

  async function toggleSidebar() {
    const opening = !sidebarOpen;
    setSidebarOpen(opening);
    if (opening) setViews(await listWorkspaces());
  }

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
    <CanvasWorkspace
      key={bootstrapped.result.workspace.templateId}
      initialWorkspace={bootstrapped.result.workspace}
      initialStorage={bootstrapped.result.storage}
      initialStatus={statusForLoad(bootstrapped.result)}
      template={bootstrapped.template}
      views={views}
      sidebarOpen={sidebarOpen}
      onCreateView={addView}
      onSelectView={selectView}
      onToggleSidebar={toggleSidebar}
      onViewTitleChange={updateViewTitle}
    />
  );
}
