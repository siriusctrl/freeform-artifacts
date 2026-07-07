export interface RevenueRow {
  month: string;
  revenue: number;
  customers: number;
  churn: number;
}

export const revenueRows: RevenueRow[] = [
  { month: "Jan", revenue: 128_000, customers: 842, churn: 0.034 },
  { month: "Feb", revenue: 142_500, customers: 891, churn: 0.031 },
  { month: "Mar", revenue: 151_800, customers: 927, churn: 0.027 },
  { month: "Apr", revenue: 163_900, customers: 981, churn: 0.025 },
  { month: "May", revenue: 178_400, customers: 1_046, churn: 0.022 },
  { month: "Jun", revenue: 193_200, customers: 1_112, churn: 0.021 },
];
