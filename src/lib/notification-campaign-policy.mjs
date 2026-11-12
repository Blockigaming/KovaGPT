/**
 * Server-side campaign eligibility. SQL additionally gates enabled and
 * start/end times; this function rejects malformed, ineligible or dismissed
 * records before any account-specific announcement reaches the browser.
 */
export function selectEligibleCampaignRows(
  rows,
  { tier, dismissedIds = new Set(), allowedEventIds, safeActionUrl },
) {
  if (!Array.isArray(rows) || !["free", "plus", "pro"].includes(tier)) return [];
  return rows
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        !dismissedIds.has(row.id) &&
        allowedEventIds.has(row.event_id) &&
        Array.isArray(row.allowed_tiers) &&
        row.allowed_tiers.includes(tier) &&
        typeof row.id === "string" &&
        /^[0-9a-f-]{36}$/i.test(row.id) &&
        typeof row.release_id === "string" &&
        row.release_id.length > 0 &&
        row.release_id.length <= 80 &&
        typeof row.title === "string" &&
        row.title.trim().length > 0 &&
        row.title.length <= 120 &&
        typeof row.body === "string" &&
        row.body.trim().length > 0 &&
        row.body.length <= 700 &&
        (row.action_path === null ||
          (typeof row.action_path === "string" && safeActionUrl(row.action_path) !== null)),
    )
    .slice(0, 2);
}
