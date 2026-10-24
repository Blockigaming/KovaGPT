import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import {
  INTRODUCTORY_OFFER_LABEL,
  INTRODUCTORY_OFFER_UNAVAILABLE,
  INTRODUCTORY_OFFER_HISTORY,
  INTRODUCTORY_OFFER_EXISTING,
  introductoryOfferForTier,
} from "@/lib/introductory-offer";
import {
  INTRODUCTORY_OFFER_REVIEW_SCENARIOS,
  createIntroductoryOfferSample,
  introductoryOfferSampleEligibility,
  introductoryOfferSampleReducer,
  type IntroductoryOfferSampleEvent,
} from "../introductory-offer-review-fixture.mjs";

export function IntroductoryOfferPreview() {
  const [sample, setSample] = useState(() => createIntroductoryOfferSample());
  const eligibility = introductoryOfferSampleEligibility(sample);
  const apply = (type: IntroductoryOfferSampleEvent["type"], scenario?: string) => {
    const event = { type, scenario, accountId: sample.accountId, generation: sample.generation };
    setSample((previous) => introductoryOfferSampleReducer(previous, event));
  };
  const eligibilityLabels = {
    unverified: "Unverified · no eligibility decision",
    "account-unavailable": "Account unavailable · no offer can be used",
    grandfathered: "Existing customer · current terms preserved",
    "already-used": "Already used · no second introductory discount",
    "eligible-sample": "Eligible in this fictional sample only",
  };
  return (
    <section
      className="min-w-0 space-y-5 [overflow-wrap:anywhere]"
      aria-labelledby="offer-preview-title"
    >
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Private review · fictional account history</p>
        <h2 id="offer-preview-title" className="text-2xl font-semibold">
          Introductory offer review
        </h2>
        <p>{INTRODUCTORY_OFFER_LABEL}.</p>
      </header>
      <div className="space-y-2 rounded-2xl border border-border p-4 text-sm leading-6">
        <p>
          No real account is checked or changed. The controls below change local sample data only.
          No checkout, payment, entitlement, cancellation, recovery or deletion request is sent.
        </p>
        <p>{INTRODUCTORY_OFFER_UNAVAILABLE}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2" aria-label="Proposed payment amounts">
        {(["plus", "pro"] as const).map((tier) => {
          const offer = introductoryOfferForTier(tier)!;
          return (
            <article key={tier} className="space-y-2 rounded-2xl border border-border p-4">
              <h3 className="font-semibold">{CAPABILITY_REGISTRY.plans[tier].name}</h3>
              <p>{offer.paymentCopy}</p>
              <p className="text-sm text-muted-foreground">
                Published plan price; final payment and eligibility require the matching backend
                contract.
              </p>
            </article>
          );
        })}
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Fictional account scenario
        <select
          className="min-h-11 w-full rounded-xl border border-border bg-background px-3"
          value={sample.scenario}
          onChange={(event) => apply("select-sample", event.target.value)}
        >
          {INTRODUCTORY_OFFER_REVIEW_SCENARIOS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <section
        className="space-y-4 rounded-2xl border border-border p-4"
        aria-label="Fictional account and offer history"
      >
        <h3 className="font-semibold">Sample account history</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Account identity</dt>
            <dd>{sample.accountId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Plan</dt>
            <dd>{CAPABILITY_REGISTRY.plans[sample.tier].name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Account state</dt>
            <dd>{sample.accountStatus}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Subscription state</dt>
            <dd>
              {sample.subscription}
              {sample.grandfathered ? " · grandfathered" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Introductory discount history</dt>
            <dd>
              {!sample.historyVerified
                ? "Unknown"
                : sample.offerUsed
                  ? "Used on this account"
                  : sample.grandfathered
                    ? "No new offer applied; existing terms retained"
                    : "Unused in this sample"}
            </dd>
          </div>
          {sample.recoveryDeadline ? (
            <div>
              <dt className="text-muted-foreground">Exact sample recovery deadline · UTC</dt>
              <dd>
                <time dateTime={sample.recoveryDeadline}>{sample.recoveryDeadline}</time>
              </dd>
            </div>
          ) : null}
        </dl>
        <p role="status" className="text-sm">
          {eligibilityLabels[eligibility]}
        </p>
        {sample.accountStatus === "expired" ? (
          <p className="text-sm">
            The 30-day recovery window has ended. This does not prove deletion occurred, and cannot
            make a new account eligible.
          </p>
        ) : null}
        {sample.previousAccountDeletionConfirmed ? (
          <p className="text-sm">
            This fictional account has a different identity after the prior account’s confirmed
            deletion. Its offer history starts separately.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {eligibility === "eligible-sample" ? (
            <Button variant="outline" onClick={() => apply("record-first-payment")}>
              Record sample first payment
            </Button>
          ) : null}
          {sample.accountStatus === "active" &&
          ["active", "trialing"].includes(sample.subscription) ? (
            <Button variant="outline" onClick={() => apply("cancel")}>
              Cancel sample subscription
            </Button>
          ) : null}
          {sample.accountStatus === "active" && sample.subscription === "canceled" ? (
            <Button variant="outline" onClick={() => apply("rejoin")}>
              Rejoin same sample account
            </Button>
          ) : null}
          {sample.accountStatus === "active" && sample.subscription === "active" ? (
            <Button variant="outline" onClick={() => apply("change-plan")}>
              Change sample plan
            </Button>
          ) : null}
          {sample.accountStatus === "active" ? (
            <Button variant="outline" onClick={() => apply("schedule-deletion")}>
              Schedule sample deletion
            </Button>
          ) : null}
          {sample.accountStatus === "scheduled" ? (
            <>
              <Button variant="outline" onClick={() => apply("recover")}>
                Recover same sample account
              </Button>
              <Button variant="outline" onClick={() => apply("pass-deadline")}>
                Advance sample beyond deadline
              </Button>
            </>
          ) : null}
          {sample.accountStatus === "expired" ? (
            <Button variant="outline" onClick={() => apply("load-deletion-receipt")}>
              Load fictional completed-deletion receipt
            </Button>
          ) : null}
          {sample.accountStatus === "deleted" ? (
            <Button variant="outline" onClick={() => apply("create-new-account")}>
              Create genuinely new sample account
            </Button>
          ) : null}
        </div>
      </section>
      <p className="text-sm leading-6 text-muted-foreground">{INTRODUCTORY_OFFER_HISTORY}</p>
      <p className="text-sm leading-6 text-muted-foreground">{INTRODUCTORY_OFFER_EXISTING}</p>
    </section>
  );
}
