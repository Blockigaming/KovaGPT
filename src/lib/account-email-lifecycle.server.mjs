import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

async function rpc(admin, name, args) {
  const pending = admin?.rpc?.(name, args);
  if (typeof pending?.abortSignal !== "function")
    throw new Error("account_email_lifecycle_unavailable");
  const result = await pending.abortSignal(AbortSignal.timeout(8000));
  if (!result || result.error) throw new Error("account_email_lifecycle_unavailable");
  return result.data;
}

/** Post-policy boundary: never retries scheduling/recovery if notification work fails. */
export async function recordAccountLifecycleNotification(
  admin,
  accountId,
  event,
  originalSchedule,
  occurredAt = new Date().toISOString(),
) {
  if (
    !UUID.test(accountId ?? "") ||
    !["account_deletion_scheduled", "account_recovered"].includes(event) ||
    !originalSchedule ||
    originalSchedule.state !== "scheduled" ||
    typeof originalSchedule.scheduledAt !== "string" ||
    typeof originalSchedule.recoverUntil !== "string"
  )
    return "unconfirmed";
  const scheduled = Date.parse(originalSchedule.scheduledAt);
  const recoverUntil = Date.parse(originalSchedule.recoverUntil);
  if (!Number.isFinite(scheduled) || recoverUntil - scheduled !== 30 * 86400000)
    return "unconfirmed";
  const occurred =
    event === "account_deletion_scheduled" ? originalSchedule.scheduledAt : occurredAt;
  // A repeated request for an old pending deletion is not a new event.
  if (event === "account_deletion_scheduled" && Date.parse(occurred) < Date.now() - 15 * 60_000)
    return "not_applicable";
  const eventKey = createHash("sha256")
    .update(`${event}:${accountId}:${new Date(scheduled).toISOString()}`)
    .digest("hex");
  try {
    const id = await rpc(admin, "account_email_record_lifecycle", {
      p_account_id: accountId,
      p_event_type: event,
      p_event_key: eventKey,
      p_occurred_at: occurred,
      p_metadata:
        event === "account_deletion_scheduled"
          ? { deletion_scheduled_for: new Date(recoverUntil).toISOString() }
          : {},
    });
    return id === null
      ? "disabled"
      : typeof id === "string" && UUID.test(id)
        ? "queued"
        : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

/** Must follow confirmed application cleanup; actual deletion commits release the notice. */
export async function prepareAccountDeletionNotification(admin, accountId, attemptId) {
  if (!UUID.test(accountId ?? "") || !UUID.test(attemptId ?? ""))
    throw new Error("account_email_deletion_binding_invalid");
  if (
    (await rpc(admin, "account_email_prepare_account_deletion", {
      p_account_id: accountId,
      p_attempt_id: attemptId,
    })) !== true
  )
    throw new Error("account_email_deletion_preparation_unconfirmed");
}
