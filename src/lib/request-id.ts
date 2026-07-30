/**
 * Request-ID + error category utilities shared by the chat pipeline.
 * The request ID is short, URL-safe, and safe to display to end users
 * for support / bug reports. It contains no secrets or prompt data.
 */

export type ChatErrorCategory =
  | "model_timeout"
  | "model_provider_failure"
  | "invalid_chart_data"
  | "chart_parser_failure"
  | "streaming_interruption"
  | "rate_limit"
  | "network_failure"
  | "rendering_failure"
  | "auth_failure"
  | "quota_exceeded"
  | "bad_request"
  | "unknown_server_failure";

export type ChatErrorEnvelope = {
  error: string;
  category: ChatErrorCategory;
  requestId: string;
  retryable: boolean;
  timestamp: string;
};

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

export function categorizeError(err: unknown, statusHint?: number): ChatErrorCategory {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err ?? "").toLowerCase();
  if (statusHint === 429 || /rate.?limit|too many/i.test(msg)) return "rate_limit";
  if (statusHint === 401 || statusHint === 403 || /unauthori[sz]ed|forbidden/i.test(msg))
    return "auth_failure";
  if (statusHint === 402 || /quota|credit|exhaust/i.test(msg)) return "quota_exceeded";
  if (/timeout|timed out|deadline/i.test(msg)) return "model_timeout";
  if (/abort|stream|connection|econnreset|network/i.test(msg)) return "streaming_interruption";
  if (/chart|graph|malformed|invalid json|json.*parse/i.test(msg)) return "invalid_chart_data";
  if (statusHint && statusHint >= 500) return "model_provider_failure";
  if (statusHint === 400) return "bad_request";
  return "unknown_server_failure";
}

export function isRetryable(cat: ChatErrorCategory): boolean {
  return (
    cat === "model_timeout" ||
    cat === "streaming_interruption" ||
    cat === "network_failure" ||
    cat === "model_provider_failure"
  );
}

export function buildErrorEnvelope(
  err: unknown,
  requestId: string,
  status: number,
): ChatErrorEnvelope {
  const category = categorizeError(err, status);
  const publicMessage =
    err instanceof Error && err.message && !/api[_-]?key|token|secret|bearer/i.test(err.message)
      ? err.message
      : "An unexpected error occurred while contacting the model.";
  return {
    error: publicMessage,
    category,
    requestId,
    retryable: isRetryable(category),
    timestamp: new Date().toISOString(),
  };
}
