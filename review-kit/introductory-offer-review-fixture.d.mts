export const INTRODUCTORY_OFFER_REVIEW_SCENARIOS: readonly (readonly [string, string])[];
export const OFFER_SAMPLE_REQUESTED_AT: string;
export const OFFER_SAMPLE_RECOVERY_DEADLINE: string;
export interface IntroductoryOfferSample {
  scenario: string;
  generation: number;
  accountId: string;
  tier: "plus" | "pro";
  historyVerified: boolean;
  priorSubscription: boolean;
  offerUsed: boolean;
  grandfathered: "trial" | "subscription" | null;
  subscription: "none" | "active" | "trialing" | "canceled";
  accountStatus: "active" | "scheduled" | "expired" | "deleted";
  recoveryDeadline: string | null;
  previousAccountDeletionConfirmed: boolean;
}
export type IntroductoryOfferSampleEvent = {
  accountId: string;
  generation: number;
  type:
    | "select-sample"
    | "record-first-payment"
    | "cancel"
    | "rejoin"
    | "change-plan"
    | "schedule-deletion"
    | "recover"
    | "pass-deadline"
    | "load-deletion-receipt"
    | "create-new-account";
  scenario?: string;
};
export function createIntroductoryOfferSample(
  scenario?: string,
  generation?: number,
): IntroductoryOfferSample;
export function introductoryOfferSampleEligibility(
  state: IntroductoryOfferSample,
): "unverified" | "account-unavailable" | "grandfathered" | "already-used" | "eligible-sample";
export function introductoryOfferSampleReducer(
  state: IntroductoryOfferSample,
  event: IntroductoryOfferSampleEvent,
): IntroductoryOfferSample;
