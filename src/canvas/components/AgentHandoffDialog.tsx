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
  const instruction = `Install the project artifact skill for your agent:
${INSTALL_COMMAND}

After installation, ask the user what artifact they want to build and clarify the data, visual form, and layout they need. Then follow the freeform-artifact-builder bundle contract and create one trusted .freeform-artifact.json file. Do not modify, commit, or deploy the application repository.

Include version, artifactId, self-contained ESM moduleSource, and serializable node title/data/config. Use ECharts options or window.React; do not use imports, network fetches, or external dependencies.

Validate the finished artifact in a real browser. If you control the user's open Freeform page, install it directly into this view:

await page.evaluate(async ({ bundle, viewId }) => {
  return window.__FREEFORM_AGENT__.installArtifact(bundle, { viewId });
}, { bundle, viewId: ${JSON.stringify(viewId)} });

Otherwise return the bundle file so the user can choose Install bundle in this dialog. Report the artifact id and target view.`;

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
