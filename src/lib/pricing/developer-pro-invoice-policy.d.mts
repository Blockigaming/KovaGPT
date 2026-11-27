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
