import {
  ACCOUNT_DELETION_GRACE_MS,
  accountDeletionDeadlinePassed,
  canRecoverAccountDeletion,
} from "../src/lib/account-deletion-grace.mjs";

// Private review fixtures only. Never import this controller into application code.
export const ACCOUNT_DELETION_REVIEW_LABEL = "Synthetic account review · No real account changes";
export const ACCOUNT_DELETION_PREVIEW_STATES = Object.freeze([
  "confirm",
  "scheduled",
  "schedule-failed",
  "recovery-failed",
  "recovered",
  "unknown",
  "at-deadline",
  "overdue",
  "deleting",
  "deleted",
  "unavailable",
]);
export const SAMPLE_REQUESTED_AT = "2026-10-19T12:00:00.000Z";
export const SAMPLE_EFFECTIVE_AT = new Date(
  Date.parse(SAMPLE_REQUESTED_AT) + ACCOUNT_DELETION_GRACE_MS,
).toISOString();

export function createAccountDeletionPreview(
  ownerId = "sample-owner-a",
  fixture = "confirm",
  generation = 0,
) {
  if (!ACCOUNT_DELETION_PREVIEW_STATES.includes(fixture)) fixture = "unknown";
  const expired = fixture === "overdue" || fixture === "at-deadline";
  const status = expired ? "expired" : fixture;
  return {
    ownerId,
    generation,
    open: false,
    status,
    schedule:
      canRecoverAccountDeletion(status) || expired
        ? {
            requestedAt: SAMPLE_REQUESTED_AT,
            effectiveAt: SAMPLE_EFFECTIVE_AT,
            timeZone: "America/Los_Angeles",
            overdue: accountDeletionDeadlinePassed(
              SAMPLE_EFFECTIVE_AT,
              Date.parse(
                fixture === "overdue"
                  ? "2026-11-19T12:00:00.000Z"
                  : fixture === "at-deadline"
                    ? SAMPLE_EFFECTIVE_AT
                    : SAMPLE_REQUESTED_AT,
              ),
            ),
          }
        : undefined,
  };
}

/** Local-only synchronous interaction; stale-owner and stale-opening events are ignored. */
export function accountDeletionPreviewReducer(state, event) {
  if (event.type === "switch-owner")
    return createAccountDeletionPreview(event.nextOwnerId, "confirm", state.generation + 1);
  if (event.ownerId !== state.ownerId || event.generation !== state.generation) return state;
  if (event.type === "fixture")
    return createAccountDeletionPreview(state.ownerId, event.fixture, state.generation + 1);
  if (event.type === "open") return { ...state, open: true };
  if (event.type === "close") return { ...state, open: false, generation: state.generation + 1 };
  if (!state.open) return state;
  if (
    event.type === "schedule" &&
    (state.status === "confirm" || state.status === "schedule-failed")
  ) {
    if (event.result === "failure")
      return { ...state, status: "schedule-failed", schedule: undefined };
    return {
      ...createAccountDeletionPreview(state.ownerId, "scheduled", state.generation),
      open: true,
    };
  }
  if (
    event.type === "recover" &&
    canRecoverAccountDeletion(state.status, state.schedule?.overdue)
  ) {
    if (event.result === "failure") return { ...state, status: "recovery-failed" };
    return { ...state, status: "recovered", schedule: undefined };
  }
  if (event.type === "check-status" && state.status === "unknown")
    return {
      ...createAccountDeletionPreview(state.ownerId, "scheduled", state.generation),
      open: true,
    };
  // No timer or clock-driven deletion exists. Started/deleted require explicit fixture selection.
  return state;
}
