import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAPABILITY_REGISTRY, PLAN_ALLOWANCE_COPY } from "@/lib/capability-registry";
import { formatDisplayDateTime, type TimeFormatPreference } from "@/lib/time-format";
import { resolveBillingPlan, type BillingTier } from "@/lib/billing-plans";
import {
  INTRODUCTORY_OFFER_LABEL,
  INTRODUCTORY_OFFER_CHECKOUT_REVIEW,
  INTRODUCTORY_OFFER_HISTORY,
  INTRODUCTORY_OFFER_EXISTING,
  introductoryOfferForTier,
} from "@/lib/introductory-offer";
import type { SubscriptionSummary } from "@/utils/payments.functions";

const TIERS = ["free", "plus", "pro"] as const;
const ALLOWANCES = [
  { label: "Messages", key: "chat" },
  { label: "Images", key: "image" },
  { label: "Uploads", key: "upload" },
  { label: "Storage", key: "storage" },
] as const;
const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment past due",
  unpaid: "Payment failed",
  incomplete: "Awaiting first payment",
  incomplete_expired: "First payment expired",
  canceled: "Canceled",
  paused: "Paused",
};

type BillingProps = {
  timeFormat?: TimeFormatPreference;
  summary: SubscriptionSummary | null;
  loading: boolean;
  error: string | null;
  loggedIn: boolean;
  portalLoading: boolean;
  inheritedSubscription: boolean;
  onManage: () => void;
};

function billingPlanAction(
  target: BillingTier,
  summary: SubscriptionSummary | null,
  blocked: boolean,
  inheritedSubscription: boolean,
): { label: string; destination: "none" | "pricing" | "portal"; disabled: boolean } {
  if (blocked || !summary)
    return { label: "Plan unavailable", destination: "none", disabled: true };
  if (target === summary.effectiveTier)
    return { label: "Current plan", destination: "none", disabled: true };
  if (summary.billingConflict || inheritedSubscription)
    return { label: "Change unavailable", destination: "none", disabled: true };
  const label = TIERS.indexOf(target) > TIERS.indexOf(summary.tier) ? "Upgrade" : "Change plan";
  // An existing billing relationship must use the authoritative portal. Never
  // start another subscription to work around unavailable plan management.
  if (summary.hasBillingAccount || summary.activeSubscriptionCount > 0)
    return { label, destination: "portal", disabled: !summary.billingPortalAvailable };
  if (target === "free") return { label, destination: "none", disabled: true };
  return { label, destination: "pricing", disabled: false };
}

function billingDate(value: string | null, timeFormat: TimeFormatPreference): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatDisplayDateTime(date, timeFormat, { dateStyle: "medium", timeStyle: "short" })
    : null;
}

export function BillingSubscriptionFacts(props: BillingProps) {
  const { summary, loading, error, loggedIn, inheritedSubscription, portalLoading, onManage } =
    props;
  const verified = loggedIn && !loading && !error && !!summary && !summary.billingConflict;
  const own = verified && !inheritedSubscription;
  const plan = own ? resolveBillingPlan(summary.priceId) : null;
  const periodEnd = own
    ? billingDate(summary.currentPeriodEnd, props.timeFormat ?? "system")
    : null;
  const renews =
    own &&
    !summary.cancelAtPeriodEnd &&
    ["active", "trialing"].includes(summary.status ?? "") &&
    !!periodEnd &&
    new Date(summary.currentPeriodEnd!).getTime() > Date.now();
  const unavailable = loading ? "Checking…" : "Unavailable";
  const status = verified
    ? inheritedSubscription
      ? "Family Sharing"
      : summary.status
        ? (STATUS_LABELS[summary.status] ?? "Status unavailable")
        : summary.tier === "free" && summary.activeSubscriptionCount === 0
          ? "No active subscription"
          : "Status unavailable"
    : unavailable;
  const noSubscription =
    own && summary.tier === "free" && summary.activeSubscriptionCount === 0 && !summary.status;
  const paymentFailed = own && ["past_due", "unpaid", "incomplete"].includes(summary.status ?? "");
  const canManage =
    own && summary.hasBillingAccount && summary.billingPortalAvailable && !portalLoading;
  return (
    <div className="kova-billing-facts">
      <dl className="kova-billing-metrics">
        <div>
          <dt>Subscription status</dt>
          <dd>{status}</dd>
        </div>
        <div>
          <dt>Billing interval</dt>
          <dd>
            {plan
              ? "Monthly (configured plan)"
              : inheritedSubscription
                ? "Managed by family owner"
                : own && !summary.status
                  ? "Not applicable"
                  : unavailable}
          </dd>
        </div>
        <div>
          <dt>
            {own && summary.cancelAtPeriodEnd
              ? "Access end date"
              : own && summary.trialing
                ? "Trial ends"
                : "Next billing date"}
          </dt>
          <dd>
            {own && (summary.cancelAtPeriodEnd || renews)
              ? (periodEnd ?? "Unavailable · check Stripe")
              : own && !summary.status
                ? "Not applicable"
                : inheritedSubscription
                  ? "Managed by family owner"
                  : unavailable}
          </dd>
        </div>
        <div>
          <dt>Next charge</dt>
          <dd>
            {noSubscription
              ? "Not applicable"
              : inheritedSubscription
                ? "Managed by family owner"
                : "Unavailable · check Stripe"}
          </dd>
        </div>
      </dl>
      <p className="kova-billing-copy">
        {noSubscription
          ? "There is no active paid subscription. Explore the available plans in Plans."
          : "The billing service does not provide a next-charge amount here. Published plan prices are shown in Plans; your final charge and any tax are confirmed by Stripe."}
      </p>
      {own && summary.cancelAtPeriodEnd && !periodEnd ? (
        <p role="status" className="kova-billing-copy">
          Cancellation is pending, but the access-end date is unavailable. Check Stripe or contact
          support before making another purchase.
        </p>
      ) : null}
      {paymentFailed ? (
        <div className="kova-billing-payment-alert" role="alert">
          <h4>Update your payment method</h4>
          <p>
            The billing service reports {status.toLowerCase()}. Your account access continues to
            follow its verified entitlement.
          </p>
          <Button type="button" variant="outline" onClick={onManage} disabled={!canManage}>
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {portalLoading ? "Opening…" : "Update payment method"}
          </Button>
          <p>
            {summary.billingPortalAvailable
              ? "Opens the external Stripe billing portal in this tab."
              : "The billing portal is unavailable. Contact support@kovagpt.com for payment help."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function BillingPlans({ onNavigate, ...props }: BillingProps & { onNavigate: () => void }) {
  const { summary, loading, error, loggedIn, portalLoading, inheritedSubscription, onManage } =
    props;
  return (
    <section aria-labelledby="billing-plans-heading">
      <h3 id="billing-plans-heading">Choose your plan</h3>
      <p className="kova-billing-copy">
        Published monthly prices in USD, plus applicable tax. Stripe confirms the final charge
        before purchase.
      </p>
      <div className="kova-billing-copy" aria-label="First-month offer">
        <p>Eligible accounts: {INTRODUCTORY_OFFER_LABEL}. Regular monthly pricing follows.</p>
        <p>{INTRODUCTORY_OFFER_CHECKOUT_REVIEW}</p>
        <p>{INTRODUCTORY_OFFER_EXISTING}</p>
      </div>
      {loading || error || !loggedIn || !summary ? (
        <p className="kova-billing-copy" role="status">
          {loading
            ? "Checking your current plan…"
            : !loggedIn
              ? "Sign in to see your current plan and available changes."
              : "Your current plan could not be verified. Return to Overview and refresh billing status."}
        </p>
      ) : null}
      <div className="kova-billing-plan-grid">
        {TIERS.map((tier) => {
          const plan = CAPABILITY_REGISTRY.plans[tier];
          const offer = introductoryOfferForTier(tier);
          const action = billingPlanAction(
            tier,
            summary,
            !loggedIn || loading || !!error,
            inheritedSubscription,
          );
          return (
            <article
              key={tier}
              className="kova-billing-plan-card"
              aria-labelledby={`billing-plan-${tier}`}
              data-current-plan={summary?.effectiveTier === tier && !loading && !error}
            >
              <h4 id={`billing-plan-${tier}`}>{plan.name}</h4>
              <p className="kova-billing-plan-price">
                <strong>${plan.monthlyPriceUsd}</strong>
                <span> / month</span>
              </p>
              <p className="kova-billing-plan-tax">
                {tier === "free" ? "No subscription charge" : "+ applicable tax"}
              </p>
              <dl className="kova-billing-plan-features">
                <div>
                  <dt>Chat modes</dt>
                  <dd>
                    {CAPABILITY_REGISTRY.modesByTier[tier].map((mode) => mode.label).join(", ")}
                  </dd>
                </div>
                {ALLOWANCES.map(({ label, key }) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{PLAN_ALLOWANCE_COPY[tier][key]}</dd>
                  </div>
                ))}
                <div>
                  <dt>Adaptive Memory</dt>
                  <dd>{tier === "free" ? "Not included" : "When enabled and available"}</dd>
                </div>
              </dl>
              <p className="kova-billing-plan-trial">
                {offer ? `If eligible: ${offer.paymentCopy}` : ""}
              </p>
              {action.destination === "pricing" && !action.disabled && !portalLoading ? (
                <Link
                  to="/pricing"
                  hash={tier}
                  onClick={onNavigate}
                  className="kova-billing-plan-action"
                  aria-label={`${action.label} to ${plan.name}`}
                  aria-describedby="billing-plan-change-help"
                >
                  {action.label}
                </Link>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="kova-billing-plan-action"
                  disabled={action.disabled || portalLoading}
                  onClick={action.destination === "portal" ? onManage : undefined}
                  aria-describedby="billing-plan-change-help"
                  aria-label={
                    action.label === "Current plan"
                      ? `${plan.name}: Current plan`
                      : `${action.label}: ${plan.name}`
                  }
                >
                  {action.label}
                  {action.destination === "portal" && !action.disabled ? (
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : null}
                </Button>
              )}
            </article>
          );
        })}
      </div>
      <p className="kova-billing-copy">{INTRODUCTORY_OFFER_HISTORY}</p>
      <p className="kova-billing-copy" id="billing-plan-change-help">
        {inheritedSubscription ? "Your shared plan is managed by the Family Sharing owner. " : ""}
        {summary?.hasBillingAccount && !summary.billingPortalAvailable
          ? "Plan management is unavailable. Contact support@kovagpt.com. "
          : ""}
        {summary?.billingConflict
          ? "Your billing records need support review before a plan change. "
          : ""}
        New-customer links open Pricing to review plans and checkout. Changes to an existing
        subscription open the external Stripe billing portal in this tab. Review the actual
        effective date, any proration, and the final charge there before confirming. If Stripe does
        not offer a change, contact support.
      </p>
    </section>
  );
}

export function BillingInvoices(props: BillingProps) {
  const { summary, loading, error, loggedIn, portalLoading, inheritedSubscription, onManage } =
    props;
  const available =
    loggedIn &&
    !loading &&
    !error &&
    !!summary &&
    !inheritedSubscription &&
    summary.hasBillingAccount &&
    summary.billingPortalAvailable;
  return (
    <section aria-labelledby="billing-invoices-heading" className="kova-billing-invoices">
      <FileText aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
      <h3 id="billing-invoices-heading">Invoices</h3>
      <p className="kova-billing-copy">
        Invoice history is unavailable in KovaGPT. The current billing service does not supply
        invoice dates, amounts, payment statuses, or download links to this page.
      </p>
      <p className="kova-billing-copy" role="status">
        {loading
          ? "Checking the billing account…"
          : !loggedIn
            ? "Sign in to check your billing account."
            : error || !summary
              ? "Your billing account could not be verified. Return to Overview and refresh billing status."
              : inheritedSubscription
                ? "Billing records are managed by the Family Sharing owner."
                : available
                  ? "View the actual invoices and any available downloads in Stripe."
                  : summary?.hasBillingAccount
                    ? "The billing portal is unavailable. Contact support@kovagpt.com for your invoices."
                    : "No billing account is linked. This page cannot confirm whether invoice records exist."}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!available || portalLoading}
        onClick={onManage}
      >
        <ExternalLink aria-hidden="true" className="h-4 w-4" />
        {portalLoading ? "Opening…" : "View invoices in Stripe"}
      </Button>
      <p className="kova-billing-copy">Opens the external Stripe billing portal in this tab.</p>
    </section>
  );
}

export function BillingWorkspace({
  children,
  onNavigate,
  onViewChange,
  ...props
}: BillingProps & { children: ReactNode; onNavigate: () => void; onViewChange: () => void }) {
  const [view, setView] = useState("overview");
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        if (next !== view) {
          onViewChange();
          setView(next);
        }
      }}
      className="kova-billing-workspace"
    >
      <TabsList aria-label="Billing sections" className="kova-billing-tabs">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="plans">Plans</TabsTrigger>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="kova-billing-tab-panel">
        {children}
      </TabsContent>
      <TabsContent value="plans" className="kova-billing-tab-panel">
        <BillingPlans {...props} onNavigate={onNavigate} />
      </TabsContent>
      <TabsContent value="invoices" className="kova-billing-tab-panel">
        <BillingInvoices {...props} />
      </TabsContent>
    </Tabs>
  );
}
