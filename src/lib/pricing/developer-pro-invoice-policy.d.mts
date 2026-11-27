export function normalizeDeveloperProInvoice(
  event: unknown,
  environment: string,
): {
  p_event: string;
  p_invoice: string;
  p_customer: string;
  p_subscription: string;
  p_price: string;
  p_period_start: string;
  p_period_end: string;
  p_paid_at: string;
  p_amount_paid: number;
} | null;

export function developerProPaymentReference(
  proof: { p_invoice: string; p_amount_paid: number },
  payments: unknown,
): { p_payment: string; p_intent: string } | null;
export function qualifyDeveloperProCharge(
  proof: { p_customer: string; p_amount_paid: number },
  reference: { p_payment: string; p_intent: string },
  intent: unknown,
): { p_payment: string; p_intent: string; p_charge: string } | null;
export function normalizeDeveloperProReversal(
  event: unknown,
  environment: string,
): {
  p_event: string;
  p_charge: string;
  p_reason: "refund" | "dispute";
  p_at: string;
} | null;
