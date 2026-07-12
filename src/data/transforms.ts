import { z } from "zod";
import { metricDataSchema, tablePreviewDataSchema } from "../artifacts/schemas";
import type { JsonObject } from "../artifacts/types";

export const revenueRowSchema = z.object({
  month: z.string(),
  revenue: z.number(),
  customers: z.number(),
  churn: z.number(),
});

export const revenueRowsSchema = z.array(revenueRowSchema).min(2);

export type RevenueRows = z.infer<typeof revenueRowsSchema>;

export interface TransformDefinition<TInput, TOutput> {
  id: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  apply: (input: TInput, params?: JsonObject) => TOutput;
}

function formatRevenue(value: number) {
  return `$${Math.round(value / 1000)}k`;
}

export const revenueSummaryTransform: TransformDefinition<
  RevenueRows,
  z.infer<typeof metricDataSchema>
> = {
  id: "revenue-summary",
  inputSchema: revenueRowsSchema,
  outputSchema: metricDataSchema,
  apply: (rows) => {
    const latest = rows.at(-1)!;
    const previous = rows.at(-2)!;
    return {
      label: "Monthly revenue",
      value: latest.revenue,
      delta: (latest.revenue - previous.revenue) / previous.revenue,
      caption: `${latest.customers.toLocaleString()} active customers`,
    };
  },
};

export const revenueTableTransform: TransformDefinition<
  RevenueRows,
  z.infer<typeof tablePreviewDataSchema>
> = {
  id: "revenue-table-preview",
  inputSchema: revenueRowsSchema,
  outputSchema: tablePreviewDataSchema,
  apply: (rows) => ({
    columns: [
      { key: "month", label: "Month" },
      { key: "revenue", label: "Revenue" },
      { key: "customers", label: "Customers" },
      { key: "churn", label: "Churn" },
    ],
    rows: rows.slice(-4).map((row) => ({
      month: row.month,
      revenue: formatRevenue(row.revenue),
      customers: row.customers,
      churn: `${Math.round(row.churn * 1000) / 10}%`,
    })),
  }),
};

export const transformRegistry = {
  [revenueSummaryTransform.id]: revenueSummaryTransform,
  [revenueTableTransform.id]: revenueTableTransform,
};

export function runTransform<TInput, TOutput>(
  transform: TransformDefinition<TInput, TOutput>,
  input: unknown,
  params?: JsonObject,
) {
  const parsedInput = transform.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false as const, message: parsedInput.error.issues.map((issue) => issue.message).join(", ") };
  }

  const output = transform.apply(parsedInput.data, params);
  const parsedOutput = transform.outputSchema.safeParse(output);
  if (!parsedOutput.success) {
    return { ok: false as const, message: parsedOutput.error.issues.map((issue) => issue.message).join(", ") };
  }

  return { ok: true as const, data: parsedOutput.data };
}
