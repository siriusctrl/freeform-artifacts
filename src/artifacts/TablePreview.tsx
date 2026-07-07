import type { ArtifactDefinition } from "./types";

interface TableColumn {
  key: string;
  label: string;
}

interface TableData {
  title: string;
  columns: TableColumn[];
  rows: Record<string, string | number>[];
}

export const tablePreviewArtifact: ArtifactDefinition<TableData> = {
  id: "table-preview",
  title: "Table Preview",
  version: "0.1.0",
  defaultSize: { width: 430, height: 260 },
  dataSchema: {
    type: "object",
    required: ["title", "columns", "rows"],
  },
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
