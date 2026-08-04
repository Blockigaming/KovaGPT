const FORBIDDEN =
  /authorization|cookie|token|secret|password|prompt|message|document|memory|evidence|content|url/i;
const VALUE_LIMIT = 200;

export type SafeLog = {
  correlationId: string;
  category: string;
  operation: string;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
};

export function sanitizeLog(input: SafeLog): SafeLog {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {})
      .filter(([key]) => !FORBIDDEN.test(key))
      .slice(0, 12)
      .map(([key, value]) => [
        key.slice(0, 48),
        typeof value === "string" ? value.slice(0, VALUE_LIMIT) : value,
      ]),
  );
  return {
    correlationId: input.correlationId.slice(0, 64),
    category: input.category.slice(0, 48),
    operation: input.operation.slice(0, 80),
    ...(Number.isFinite(input.durationMs)
      ? { durationMs: Math.max(0, Math.min(300_000, input.durationMs!)) }
      : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function logOperationalEvent(input: SafeLog): void {
  try {
    console.info(JSON.stringify({ level: "info", ...sanitizeLog(input) }));
  } catch {
    // Observability must never affect the primary operation.
  }
}
