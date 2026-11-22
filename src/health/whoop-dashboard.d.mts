import type { OuraAnalytics } from "./oura-analytics.server.mjs";

export const WHOOP_METRICS: readonly {
  id: string;
  label: string;
  group: string;
  unit: string;
  aggregation: string;
}[];

export function whoopDashboardReport(summary: unknown): OuraAnalytics | null;
