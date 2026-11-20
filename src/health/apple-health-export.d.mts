export type AppleHealthDay = { date: string; value: number };
export type AppleHealthSource = { name: string; days: AppleHealthDay[] };
export type AppleHealthAnalytics = {
  asOf: string;
  metrics: Record<string, AppleHealthSource[] | undefined>;
};

export function readAppleHealthExport(
  file: File,
  signal?: AbortSignal,
): Promise<AppleHealthAnalytics>;
