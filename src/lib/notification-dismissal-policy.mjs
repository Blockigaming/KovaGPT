/** Dismissal is scoped to an account and a specific announcement campaign. */
const PERSISTENT_GROUPS = new Set(["announcements", "onboarding", "feedback"]);
const PROMOTIONAL_BILLING_IDS = new Set([
  "offer_available",
  "upgrade_available",
  "more_reasoning",
  "more_images",
  "more_uploads",
  "restricted_tool",
]);
export function notificationDismissalKey({ accountId, id, campaignId, group } = {}) {
  if (
    !accountId ||
    typeof accountId !== "string" ||
    !id ||
    typeof id !== "string" ||
    !group ||
    !(PERSISTENT_GROUPS.has(group) || (group === "billing" && PROMOTIONAL_BILLING_IDS.has(id)))
  )
    return null;
  const stable = [accountId, id, campaignId || "v1"];
  if (stable.some((x) => typeof x !== "string" || x.length > 128 || !/^[a-z0-9_.:@-]+$/i.test(x)))
    return null;
  return "kova:notice:dismissed:" + stable.map(encodeURIComponent).join(":");
}
/**
 * Returning users should not receive the same announcement repeatedly.
 * Operational failures, confirmations and usage alerts must never be suppressed
 * by this policy.
 */
export function noticeIsDismissed(storage, details) {
  const key = notificationDismissalKey(details);
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}
export function rememberNoticeDismissal(storage, details) {
  const key = notificationDismissalKey(details);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
