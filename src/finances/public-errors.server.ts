const FINANCE_PUBLIC_ERRORS = new Map<string, number>([
  ["plaid_not_configured", 503],
  ["finance_region_ineligible", 400],
  ["finance_connection_store_failed", 503],
  ["finance_plan_required", 403],
  ["public_token_required", 400],
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
