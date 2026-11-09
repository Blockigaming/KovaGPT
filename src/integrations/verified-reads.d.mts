export type VerifiedReadAccount = {
  id: string;
  provider_id: string;
  updated_at: string;
};
export type VerifiedReadEvent = {
  linked_account_id: string | null;
  event_type: string;
  result: string;
  safe_summary: string;
  created_at: string;
};
export function verifiedConnectionReadDates(
  accounts: VerifiedReadAccount[] | null,
  events: VerifiedReadEvent[] | null,
  flows: Record<string, { provider: string; label: string }>,
): Record<string, Record<string, string>>;
