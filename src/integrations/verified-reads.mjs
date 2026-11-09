// Operational verification is tied to a successful, audited service read on
// the same owner account grant. OAuth identity checks and unrelated services
// must never count as verified reads.
export function verifiedConnectionReadDates(accounts, events, flows) {
  const byId = new Map((accounts ?? []).map((account) => [account.id, account]));
  const verified = Object.create(null);
  for (const event of events ?? []) {
    if (event.event_type !== "read" || event.result !== "success") continue;
    const account = byId.get(event.linked_account_id);
    if (!account || typeof account.updated_at !== "string") continue;
    const when = Date.parse(event.created_at);
    const grant = Date.parse(account.updated_at);
    if (!Number.isFinite(when) || !Number.isFinite(grant) || when < grant) continue;
    for (const [id, flow] of Object.entries(flows)) {
      if (
        flow.provider !== account.provider_id ||
        event.safe_summary !== `Read ${flow.label} search results`
      )
        continue;
      const current = verified[account.id]?.[id];
      if (current && Date.parse(current) >= when) continue;
      if (!verified[account.id]) verified[account.id] = Object.create(null);
      verified[account.id][id] = event.created_at;
    }
  }
  return verified;
}
