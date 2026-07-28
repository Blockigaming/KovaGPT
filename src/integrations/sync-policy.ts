export function syncRetryDelay(attempt: number, retryAfterSeconds?: number) {
  const exponential = Math.min(15 * 60_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.max(exponential, Math.min(60 * 60_000, (retryAfterSeconds ?? 0) * 1000));
}
export function nextSyncState(input: {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  deletionRequested: boolean;
}) {
  if (input.deletionRequested) return { status: "cancelled" as const, propagateDeletion: true };
  if (!input.retryable || input.attempt >= input.maxAttempts)
    return { status: "failed" as const, propagateDeletion: false };
  return {
    status: "retry_wait" as const,
    propagateDeletion: false,
    availableInMs: syncRetryDelay(input.attempt),
  };
}
