import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import { installRelayDeliveryIntoStoredView } from "./relay/installDelivery";
import type { RelayDeliveryIdentity, RelayLiveInstaller } from "./relay/types";
import { useArtifactRelaySession } from "./relay/useArtifactRelaySession";
import {
  createWorkspace,
  listWorkspaces,
  loadOrCreateWorkspace,
  loadRelayInstallReceipt,
  loadWorkspaceById,
  RelayReceiptAlreadyExistsError,
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
  const liveRelayInstallerRef = useRef<RelayLiveInstaller | null>(null);
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
    setViews(await listWorkspaces());
    return result;
  }, []);
  const relay = useArtifactRelaySession(installRelayDelivery);
  const registerRelayInstaller = useCallback((installer: RelayLiveInstaller | null) => {
    liveRelayInstallerRef.current = installer;
  }, []);

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
      relay={relay}
      onCreateView={addView}
      onSelectView={selectView}
      onToggleSidebar={toggleSidebar}
      onViewTitleChange={updateViewTitle}
      onRegisterRelayInstaller={registerRelayInstaller}
    />
  );
}
