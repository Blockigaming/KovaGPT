/** A user who explicitly asks to search should get sources or a clear failure. */
export function isExplicitWebSearchRequest(value) {
  return (
    typeof value === "string" &&
    /\b(?:use|run|perform|do)\s+(?:a\s+)?(?:live\s+)?web\s+search\b|\bsearch\s+(?:the\s+)?(?:live\s+)?web\b/i.test(
      value,
    )
  );
}

/** Keep provider diagnostics useful without logging prompts or raw error bodies. */
export function classifySearchProviderError(error) {
  const allowedCodes = new Set([
    "invalid_api_key",
    "insufficient_quota",
    "rate_limit_exceeded",
    "model_not_found",
    "permission_denied",
    "invalid_request_error",
    "unsupported_model",
    "search_budget_exhausted",
    "search_budget_unavailable",
    "openai_not_configured",
    "generation_disabled",
    "operator_mode_active",
    "incomplete_provider_response",
    "search_not_completed",
    "provider_cleanup_unconfirmed",
  ]);
  const status = error && typeof error === "object" ? error.status : undefined;
  const code = error && typeof error === "object" ? (error.code ?? error.message) : undefined;
  return {
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
    code: allowedCodes.has(code) ? code : "provider_error",
  };
}
