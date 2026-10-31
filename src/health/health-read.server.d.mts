export type HealthSummary = {
  provider: string;
  fetchedAt: string;
  limited: boolean;
  missing: string[];
  summaries: {
    metric: string;
    date: string | null;
    score: number | null;
    scoreUnit: string;
    steps: number | null;
    restingHeartRate: number | null;
  }[];
};
export function healthReadRequest(
  provider: string,
  metric: string,
  token: string,
  now?: number,
): { url: string; scope: string; init: RequestInit };
export function confirmedHealthScopes(
  provider: string,
  requested: string[],
  reported: string | undefined,
  token: string,
  fetchImpl?: typeof fetch,
  ensureCurrent?: () => Promise<void>,
): Promise<string[]>;
export function readHealthSummary(
  provider: string,
  scopes: string[],
  token: string,
  ensureCurrent: () => Promise<void>,
  fetchImpl?: typeof fetch,
  now?: number,
): Promise<HealthSummary>;
