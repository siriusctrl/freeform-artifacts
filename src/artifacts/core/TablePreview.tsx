import type { ArtifactDefinition } from "../types";
import { tablePreviewDataSchema, type TablePreviewData } from "../schemas";

export const tablePreviewArtifact: ArtifactDefinition<TablePreviewData> = {
  id: "table-preview",
  title: "Table Preview",
  version: "0.1.0",
  defaultSize: { width: 430, height: 260 },
  dataSchema: {
    type: "object",
    required: ["title", "columns", "rows"],
  },
  dataValidator: tablePreviewDataSchema,
  render: ({ data }) => (
    <article className="artifact table-card">
      <div className="table-title">{data.title}</div>
      <table>
        <thead>
          <tr>
            {data.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={index}>
              {data.columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  ),
};
