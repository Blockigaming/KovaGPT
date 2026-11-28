export type DeveloperProbeState = "ready" | "degraded" | "unavailable" | "unknown";
export type DeveloperProbe = { id: string; state: DeveloperProbeState; checkedAt: string };
export const developerStatusProbes: readonly { id: string; label: string; path: string }[];
export function developerProbeState(id: string, status: number, body: unknown): DeveloperProbeState;
export function checkDeveloperStatus(
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<DeveloperProbe[]>;
