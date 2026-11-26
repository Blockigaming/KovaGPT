export function percentile(values: number[], p: number): number | null;
export function summarizeLatency(records: Array<Record<string, number>>): Record<
  "firstFeedback" | "firstSubstantive" | "interrupt",
  { count: number; p50: number | null; p95: number | null }
>;
export function createVoiceLatencyTracker(options?: { now?: () => number; maxRecords?: number }): {
  speechEnded(at?: number): void;
  audible(options: { substantive: boolean }): void;
  interruptRequested(at?: number): void;
  interruptSilenced(): void;
  records(): Array<Record<string, number>>;
  summary(): ReturnType<typeof summarizeLatency>;
};
