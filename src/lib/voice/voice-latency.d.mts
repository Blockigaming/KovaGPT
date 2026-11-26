type LatencyMetric = "firstFeedback" | "firstSubstantive" | "interrupt";
type LatencyStats = { count: number; p50: number | null; p95: number | null };
type LatencySummary = Record<LatencyMetric, LatencyStats>;
type TrackerOptions = { now?: () => number; maxRecords?: number };
export function percentile(values: number[], p: number): number | null;
export function summarizeLatency(records: Array<Record<string, number>>): LatencySummary;
export function createVoiceLatencyTracker(options?: TrackerOptions): {
  speechEnded(at?: number): void;
  audible(options: { substantive: boolean }): void;
  interruptRequested(at?: number): void;
  interruptSilenced(): void;
  records(): Array<Record<string, number>>;
  summary(): ReturnType<typeof summarizeLatency>;
};
