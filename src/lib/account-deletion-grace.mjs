/** Presentation policy only. A deadline never authorizes or starts deletion. */
export const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export function accountDeletionDeadlinePassed(effectiveAt, observedAt) {
  const deadline = Date.parse(effectiveAt);
  return Number.isFinite(deadline) && Number.isFinite(observedAt) && observedAt >= deadline;
}

/** Expiry can close recovery, but can never establish that deletion started. */
export function canRecoverAccountDeletion(status, deadlinePassed = false) {
  return !deadlinePassed && (status === "scheduled" || status === "recovery-failed");
}

export function formatAccountDeletionDate(iso, timeZone) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return "Date unavailable";
  }
}
