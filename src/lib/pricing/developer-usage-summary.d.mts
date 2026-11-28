export const developerUsageDimensions: Readonly<Record<string, string>>;
export function developerUsageDimension(usage: unknown, key: string): number | null;
export type DeveloperUsageTotals = {
  dimensions: Record<string, { measured: number; total: number }>;
  requests: number;
  measuredRequests: number;
  measuredSearchRequests: number;
  webSearchCalls: number;
  measuredModerationRequests: number;
  moderationRequests: number;
  measuredTranscriptionRequests: number;
  transcriptionSeconds: number;
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
