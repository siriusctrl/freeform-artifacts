import type { ArtifactDefinition } from "./types";

interface FlowStep {
  label: string;
  detail: string;
  metric: string;
}

interface FlowDiagramData {
  title: string;
  summary: string;
  steps: FlowStep[];
}

export const flowDiagramArtifact: ArtifactDefinition<FlowDiagramData> = {
  id: "flow-diagram",
  title: "Flow Diagram",
  version: "0.1.0",
  defaultSize: { width: 560, height: 300 },
  dataSchema: {
    type: "object",
    required: ["title", "summary", "steps"],
  },
  render: ({ data }) => (
    <article className="artifact flow-diagram">
      <div className="flow-header">
        <div>
          <div className="artifact-kicker">artifact pipeline</div>
          <div className="flow-title">{data.title}</div>
        </div>
        <div className="flow-summary">{data.summary}</div>
      </div>
      <div className="flow-grid">
        {data.steps.map((step, index) => (
          <div className="flow-step" key={step.label}>
            <div className="flow-step-index">{String(index + 1).padStart(2, "0")}</div>
            <div className="flow-step-body">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
            <div className="flow-step-metric">{step.metric}</div>
          </div>
        ))}
      </div>
      <div className="flow-rail" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </article>
  ),
};
