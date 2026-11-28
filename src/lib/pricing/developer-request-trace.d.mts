export type DeveloperRequestTrace = {
  request: Record<string, string | number | null>;
  meters: Record<string, number | null>;
  timeline: { stage: string; at: string }[];
  serviceObservation: {
    observedAt: string;
    sampleSize: number;
    truncated: boolean;
    counts: Record<string, number>;
    providerHealth: "unknown";
  };
};
export function developerRequestTrace(
  row: Record<string, unknown>,
  recentRows: { settlement_state: string }[],
  observedAt: string,
): DeveloperRequestTrace;
