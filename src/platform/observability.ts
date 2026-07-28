export type Metric = Readonly<{
  name: string;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}>;
const MAX_METRICS = 250;
let metrics: Metric[] = [];

export function recordMetric(metric: Metric) {
  metrics = [...metrics.slice(-(MAX_METRICS - 1)), Object.freeze(metric)];
}
export function getMetrics() {
  return [...metrics];
}
export function measure<T>(name: string, operation: () => T, metadata?: Metric["metadata"]): T {
  const started = performance.now();
  try {
    return operation();
  } finally {
    recordMetric({
      name,
      durationMs: performance.now() - started,
      timestamp: Date.now(),
      metadata,
    });
  }
}
export async function measureAsync<T>(
  name: string,
  operation: () => Promise<T>,
  metadata?: Metric["metadata"],
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    recordMetric({
      name,
      durationMs: performance.now() - started,
      timestamp: Date.now(),
      metadata,
    });
  }
}
