import type { ArtifactDefinition } from "../types";
import { flowDiagramDataSchema, type FlowDiagramData } from "../schemas";

export const flowDiagramArtifact: ArtifactDefinition<FlowDiagramData> = {
  id: "flow-diagram",
  title: "Flow Diagram",
  version: "0.1.0",
  defaultSize: { width: 560, height: 300 },
  dataSchema: {
    type: "object",
    required: ["title", "summary", "steps"],
  },
  dataValidator: flowDiagramDataSchema,
  render: ({ data }) => (
    <article className="artifact flow-diagram">
      <div className="flow-header">
        <div className="flow-title">{data.title}</div>
        <div className="flow-summary">{data.summary}</div>
      </div>
      <div className="flow-grid" role="list">
        <div className="flow-connector" aria-hidden="true" />
        {data.steps.map((step) => (
          <div className="flow-step" role="listitem" key={step.label}>
            <span className="flow-step-node" aria-hidden="true" />
            <div className="flow-step-body">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
            <div className="flow-step-metric">{step.metric}</div>
          </div>
        ))}
      </div>
    </article>
  ),
};
