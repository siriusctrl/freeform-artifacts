import { Check, Copy, PackagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface AgentHandoffDialogProps {
  open: boolean;
  viewId: string;
  onClose: () => void;
  onInstallBundle: (file: File) => void;
}

const INSTALL_COMMAND =
  "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder";

export function AgentHandoffDialog({ open, viewId, onClose, onInstallBundle }: AgentHandoffDialogProps) {
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const instruction = `Delivery mode: BROWSER_VIEW_BUNDLE
Target Freeform view id: ${viewId}
This request came from Build with AI inside an open Freeform browser. Use the Browser View Bundle workflow from the skill. Do not use the Self-Deployed Repo workflow.
Output routing: this browser mode produces a .freeform-artifact.json bundle outside the app source tree and installs it into the target view. Self-deployed mode produces src/artifacts/generated/<name>.artifact.tsx, but that is not this request.

Install the project artifact skill for your agent:
${INSTALL_COMMAND}

After installation, ask the user what artifact they want to build and clarify the data, visual form, and layout they need. Then create one trusted .freeform-artifact.json bundle outside the application source tree. Do not create src/artifacts/generated files. Do not modify, commit, or deploy the application repository.

Include version, artifactId, self-contained ESM moduleSource, and serializable node title/data/config. Use renderer: "chart-kit" for ordinary bar, line, or combo charts. Use raw ECharts only for a capability the Chart Kit cannot express, and use React only for non-chart composition. Do not use imports, network fetches, or external dependencies.

If you control the user's open Freeform page, read window.__FREEFORM_AGENT__.capabilities, then validate without persistence:

const validation = await page.evaluate(async (bundle) => {
  return window.__FREEFORM_AGENT__.validateArtifact(bundle);
}, bundle);

Only after validation succeeds, install it directly into this view:

await page.evaluate(async ({ bundle, viewId }) => {
  return window.__FREEFORM_AGENT__.installArtifact(bundle, { viewId });
}, { bundle, viewId: ${JSON.stringify(viewId)} });

Inspect the installed card at default and minimum size in light and dark mode, including long labels and empty-data behavior. Otherwise return the bundle file so the user can choose Install bundle in this dialog. The final deliverable for this mode is the bundle or installed browser artifact, never a repository source file. Report the artifact id, validation result, and target view.`;

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    copyButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  async function copyInstruction() {
    await navigator.clipboard.writeText(instruction);
    setCopied(true);
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title">
        <header className="agent-dialog-header">
          <div className="agent-dialog-title">
            <Sparkles size={20} />
            <div>
              <h2 id="agent-dialog-title">Build with AI</h2>
              <p>Install the skill, then let your agent ask what to build.</p>
            </div>
          </div>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <pre className="agent-instruction" data-testid="agent-instruction">
          {instruction}
        </pre>

        <footer className="agent-dialog-actions">
          <input
            ref={bundleInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            data-testid="artifact-bundle-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onInstallBundle(file);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" className="secondary-action install-bundle-action" data-testid="install-bundle" onClick={() => bundleInputRef.current?.click()}>
            <PackagePlus size={17} />
            <span>Install bundle</span>
          </button>
          <button type="button" className="secondary-action" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={copyButtonRef}
            type="button"
            className="primary-action dialog-primary"
            data-testid="copy-agent-instruction"
            onClick={copyInstruction}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            <span>{copied ? "Copied" : "Copy instruction"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
