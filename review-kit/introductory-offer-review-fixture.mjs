import { ACCOUNT_DELETION_GRACE_MS } from "../src/lib/account-deletion-grace.mjs";

// Fictional, local review state only. Never import this into the application.
// These samples demonstrate the proposed lifecycle; they cannot establish a
// customer's eligibility, receive payment, grant access or delete an account.
export const INTRODUCTORY_OFFER_REVIEW_SCENARIOS = Object.freeze([
  ["new-account", "New customer · eligible sample"],
  ["unverified", "Account history unavailable"],
  ["used", "First-month offer already used"],
  ["canceled", "Canceled · offer remains used"],
  ["rejoined", "Rejoined same account · offer remains used"],
  ["plan-changed", "Changed plans · offer remains used"],
  ["existing-trial", "Grandfathered trial"],
  ["existing-subscription", "Grandfathered subscription"],
  ["deletion-scheduled", "Scheduled deletion · offer remains used"],
  ["recovered", "Recovered same account · offer remains used"],
  ["deadline-passed", "Recovery deadline passed · deletion unconfirmed"],
  ["actually-deleted", "Actual deletion confirmed · sample only"],
  ["new-after-deletion", "Genuinely new account after actual deletion"],
]);
export const OFFER_SAMPLE_REQUESTED_AT = "2026-10-19T12:00:00.000Z";
export const OFFER_SAMPLE_RECOVERY_DEADLINE = new Date(
  Date.parse(OFFER_SAMPLE_REQUESTED_AT) + ACCOUNT_DELETION_GRACE_MS,
).toISOString();

export function createIntroductoryOfferSample(scenario = "new-account", generation = 0) {
  const known = INTRODUCTORY_OFFER_REVIEW_SCENARIOS.some(([id]) => id === scenario);
  if (!known) scenario = "unverified";
  const existing = scenario === "existing-trial" || scenario === "existing-subscription";
  const fresh = scenario === "new-account" || scenario === "new-after-deletion";
  return {
    scenario,
    generation,
    accountId: scenario === "new-after-deletion" ? "sample-new-account-b" : "sample-account-a",
    tier: scenario === "plan-changed" ? "pro" : "plus",
    historyVerified: scenario !== "unverified",
    priorSubscription: !fresh && scenario !== "unverified",
    offerUsed: !fresh && !existing && scenario !== "unverified",
    grandfathered: existing ? (scenario === "existing-trial" ? "trial" : "subscription") : null,
    subscription: existing
      ? scenario === "existing-trial"
        ? "trialing"
        : "active"
      : ["used", "rejoined", "plan-changed", "recovered"].includes(scenario)
        ? "active"
        : scenario === "canceled"
          ? "canceled"
          : "none",
    accountStatus:
      scenario === "actually-deleted"
        ? "deleted"
        : scenario === "deletion-scheduled"
          ? "scheduled"
          : scenario === "deadline-passed"
            ? "expired"
            : "active",
    recoveryDeadline: ["deletion-scheduled", "deadline-passed"].includes(scenario)
      ? OFFER_SAMPLE_RECOVERY_DEADLINE
      : null,
    previousAccountDeletionConfirmed: scenario === "new-after-deletion",
  };
}

export function introductoryOfferSampleEligibility(state) {
  if (!state.historyVerified) return "unverified";
  if (state.accountStatus !== "active") return "account-unavailable";
  if (state.grandfathered) return "grandfathered";
  if (state.offerUsed || state.priorSubscription) return "already-used";
  return "eligible-sample";
}

/** Scoped sample events never consume a real offer or change real account state. */
export function introductoryOfferSampleReducer(state, event) {
  if (event.accountId !== state.accountId || event.generation !== state.generation) return state;
  if (event.type === "select-sample")
    return createIntroductoryOfferSample(event.scenario, state.generation + 1);
  if (
    event.type === "record-first-payment" &&
    introductoryOfferSampleEligibility(state) === "eligible-sample"
  )
    return {
      ...state,
      scenario: "used",
      offerUsed: true,
      priorSubscription: true,
      subscription: "active",
    };
  if (
    event.type === "cancel" &&
    state.accountStatus === "active" &&
    ["active", "trialing"].includes(state.subscription)
  )
    return { ...state, scenario: "canceled", subscription: "canceled" };
  if (
    event.type === "rejoin" &&
    state.accountStatus === "active" &&
    state.subscription === "canceled"
  )
    return { ...state, scenario: "rejoined", subscription: "active" };
  if (
    event.type === "change-plan" &&
    state.accountStatus === "active" &&
    state.subscription === "active"
  )
    return { ...state, scenario: "plan-changed", tier: state.tier === "plus" ? "pro" : "plus" };
  if (event.type === "schedule-deletion" && state.accountStatus === "active")
    return {
      ...state,
      scenario: "deletion-scheduled",
      accountStatus: "scheduled",
      recoveryDeadline: OFFER_SAMPLE_RECOVERY_DEADLINE,
    };
  if (event.type === "recover" && state.accountStatus === "scheduled")
    return { ...state, scenario: "recovered", accountStatus: "active", recoveryDeadline: null };
  if (event.type === "pass-deadline" && state.accountStatus === "scheduled")
    return { ...state, scenario: "deadline-passed", accountStatus: "expired" };
  // Time alone never confirms deletion. Only this explicit fictional receipt does.
  if (
    event.type === "load-deletion-receipt" &&
    ["scheduled", "expired"].includes(state.accountStatus)
  )
    return {
      ...state,
      scenario: "actually-deleted",
      accountStatus: "deleted",
      recoveryDeadline: null,
    };
  if (event.type === "create-new-account" && state.accountStatus === "deleted")
    return {
      ...createIntroductoryOfferSample("new-after-deletion", state.generation + 1),
      accountId: `${state.accountId}-new-${state.generation + 1}`,
    };
  return state;
}
