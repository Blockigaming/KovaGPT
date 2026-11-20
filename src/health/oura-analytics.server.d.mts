import type { AppleHealthAnalytics } from "./apple-health-export.mjs";
export type OuraAnalytics = AppleHealthAnalytics & {
  missing: string[];
  unavailable: string[];
  limited: boolean;
  fetchedAt: string;
};
export function probeOuraScope(
  scope: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean>;
export function readOuraAnalytics(
  scopes: string[],
  token: string,
  ensureCurrent: () => Promise<void>,
  fetchImpl?: typeof fetch,
  now?: number,
): Promise<OuraAnalytics>;
