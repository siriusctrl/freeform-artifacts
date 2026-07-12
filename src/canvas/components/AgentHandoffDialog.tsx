import { Check, Copy, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface AgentHandoffDialogProps {
  open: boolean;
  onClose: () => void;
}

const INSTALL_COMMAND =
  "npx skills add siriusctrl/freeform-artifacts --skill freeform-artifact-builder --agent claude-code -y";

export function AgentHandoffDialog({ open, onClose }: AgentHandoffDialogProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);
  const instruction = useMemo(
    () => `Work in a local clone of https://github.com/siriusctrl/freeform-artifacts.

1. Install the project artifact skill for Claude Code:
   ${INSTALL_COMMAND}
2. Read and follow the installed freeform-artifact-builder skill and this repository's AGENTS.md.
3. Implement this artifact request:

   ${description.trim() || "Describe the artifact here."}

4. Put repo-compiled code under src/artifacts/generated/ and keep data transforms outside rendering code.
5. Add a well-positioned initial node to src/canvas/seeds/demoBoard.ts and increment the market-overview template version.
6. Run npm run check, npm run verify:ui, npm run verify:preview, and npm run verify:proof. Inspect the GIF and every contact-sheet frame.
7. Commit and push the verified change. Report the public URL and remind the owner to use More > Reset demo to load the updated published board into an existing browser workspace.`,
    [description],
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
              <p>Generate a repository-aware Claude Code handoff.</p>
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
