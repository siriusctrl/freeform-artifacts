import { Check, Copy, PackagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface AgentHandoffDialogProps {
  open: boolean;
  viewId: string;
  onClose: () => void;
  onInstallBundle: (file: File) => void;
}

const INSTALL_COMMAND =
  "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder --agent claude-code -y";

export function AgentHandoffDialog({ open, viewId, onClose, onInstallBundle }: AgentHandoffDialogProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);
  const instruction = useMemo(
    () => `Create a trusted Freeform Artifact bundle for this request. Do not modify, commit, or deploy the application repository.

1. Install the project artifact skill for Claude Code:
   ${INSTALL_COMMAND}
2. Follow the freeform-artifact-builder bundle contract and create one .freeform-artifact.json file.
3. Build this artifact:

   ${description.trim() || "Describe the artifact here."}

4. Include version, artifactId, self-contained ESM moduleSource, and serializable node title/data/config. Use ECharts options or window.React; do not use imports, network fetches, or external dependencies.
5. Validate in a real browser. If you control the user's open Freeform page, install directly:

   await page.evaluate(async ({ bundle, viewId }) => {
     return window.__FREEFORM_AGENT__.installArtifact(bundle, { viewId });
   }, { bundle, viewId: ${JSON.stringify(viewId)} });

6. Otherwise return the bundle file so the user can choose Install bundle in this dialog. Report the artifact id and target view.`,
    [description, viewId],
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
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
              <p>Generate and install an artifact bundle without changing the app.</p>
            </div>
          </div>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <label className="agent-request-label" htmlFor="agent-request">
          Artifact request
        </label>
        <textarea
          ref={inputRef}
          id="agent-request"
          data-testid="agent-request"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setCopied(false);
          }}
          placeholder="A cohort retention chart from monthly customer activity..."
        />

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
            type="button"
            className="primary-action dialog-primary"
            data-testid="copy-agent-instruction"
            disabled={!description.trim()}
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
