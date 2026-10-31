const FINANCE_PUBLIC_ERRORS = new Map<string, number>([
  ["plaid_not_configured", 503],
  ["finance_region_ineligible", 400],
  ["finance_connection_store_failed", 503],
  ["finance_connection_recovery_needed", 503],
  ["finance_plan_required", 403],
  ["public_token_required", 400],
  ["plaid_request_cancelled", 504],
  ["plaid_transport_failed", 502],
  ["plaid_response_rejected", 502],
  ["finance_connection_not_found", 404],
  ["finance_connection_changed", 409],
  ["finance_rate_limited", 429],
  ["finance_session_expired", 401],
  ["finance_audit_unavailable", 503],
  ["lockdown_blocked_connector_read", 403],
  ["lockdown_blocked_connector_write", 403],
]);

export type PublicFinanceError = { error: string; status: number; logCode: string };

export function publicFinanceError(
  error: unknown,
  fallback: "finance_unavailable" | "finance_exchange_failed",
): PublicFinanceError {
  const raw = error instanceof Error ? error.message : "";
  const knownStatus = FINANCE_PUBLIC_ERRORS.get(raw);
  if (knownStatus) return { error: raw, status: knownStatus, logCode: raw };
  if (/^plaid_\d{3}$/u.test(raw)) {
    return {
      error: "finance_provider_unavailable",
      status: 502,
      logCode: raw,
    };
  }
  return {
    error: fallback,
    status: 500,
    logCode: "finance_failure",
  };
}
