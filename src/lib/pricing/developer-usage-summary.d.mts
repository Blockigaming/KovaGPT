export type DeveloperUsageTotals = {
  requests: number;
  measuredRequests: number;
  measuredSearchRequests: number;
  webSearchCalls: number;
  tokens: Record<
    "input_tokens" | "cached_input_tokens" | "image_input_tokens" | "output_tokens",
    number
  >;
  charges: { currency: string; amount: string }[];
};
export type DeveloperUsageGroup = DeveloperUsageTotals & { label: string };
export type DeveloperUsageSummary = DeveloperUsageTotals & {
  days: DeveloperUsageGroup[];
  models: DeveloperUsageGroup[];
  services: DeveloperUsageGroup[];
  statuses: DeveloperUsageGroup[];
};
export function summarizeDeveloperUsage(rows: unknown[]): DeveloperUsageSummary;
