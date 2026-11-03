import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { getSubscriptionSummary } from "@/utils/payments.functions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";

export function PublicPlans() {
  const [group, setGroup] = useState<"individual" | "business">("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [checkoutOwner, setCheckoutOwner] = useState<string | null>(null);
  const { isLoaded, isSignedIn, user } = useUser();
  const owner = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const lifetime = useRef({ owner, active: true, generation: 0 });
  if (lifetime.current.owner !== owner) {
    lifetime.current.owner = owner;
    lifetime.current.generation++;
  }
  const inFlight = useRef(false);
  const summary = useServerFn(getSubscriptionSummary);
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();
  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => {
      state.active = false;
      state.generation++;
    };
  }, []);
  useEffect(() => {
    closeCheckout();
    setCheckoutOwner(null);
    setError(null);
  }, [owner, closeCheckout]);

  const choosePlan = async (tier: "plus" | "pro") => {
    if (!isLoaded || inFlight.current) return;
    const priceId = CAPABILITY_REGISTRY.plans[tier].lookupKey!;
    if (!owner) {
      window.location.assign(`/login?return_to=${encodeURIComponent(`/pricing?plan=${priceId}`)}`);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const generation = lifetime.current.generation;
    const current = () =>
      lifetime.current.active &&
      lifetime.current.owner === owner &&
      lifetime.current.generation === generation;
    try {
      const billing = await summary({ data: { environment: "live" } });
      if (!current()) return;
      // Inherited paid access, ambiguous histories, and existing subscriptions
      // always go through account management; never open a second subscription.
      if (
        billing.billingConflict ||
        billing.activeSubscriptionCount > 0 ||
        billing.effectiveTier !== "free"
      ) {
        window.location.assign("/settings/billing");
        return;
      }
      setCheckoutOwner(owner);
      openCheckout({ priceId, userId: owner });
    } catch {
      if (current())
        setError("Your plan couldn’t be verified. Try again or contact billing support.");
    } finally {
      inFlight.current = false;
      if (lifetime.current.active) setBusy(false);
    }
  };

  return (
    <section className="public-plans" aria-labelledby="public-plans-title">
      <h2 id="public-plans-title">Explore plans</h2>
      <div className="public-plan-toggle" role="group" aria-label="Plan type">
        <button
          type="button"
          aria-pressed={group === "individual"}
          onClick={() => setGroup("individual")}
        >
          Individual
        </button>
        <button
          type="button"
          aria-pressed={group === "business"}
          onClick={() => setGroup("business")}
        >
          Team and Enterprise
        </button>
      </div>
      {group === "individual" ? (
        <div className="public-plan-grid">
          {(["free", "plus", "pro"] as const).map((tier, index) => {
            const plan = CAPABILITY_REGISTRY.plans[tier];
            return (
              <article className="public-plan-card" key={tier}>
                <PlanGlyph level={index + 1} />
                <h3>{tier === "free" ? "Free" : `Kova ${plan.name}`}</h3>
                <p className="public-plan-description">
                  {tier === "free"
                    ? "A place to start"
                    : tier === "plus"
                      ? "For everyday work"
                      : "For your most ambitious work"}
                </p>
                <div className="public-plan-price">
                  ${plan.monthlyPriceUsd}
                  <span>{tier === "free" ? "" : "/month"}</span>
                </div>
                <p className="public-plan-period">
                  {tier === "free" ? "Free for everyone" : "Billed monthly in USD"}
                </p>
                {tier === "free" ? (
                  <Link to={"/signup" as never} className="public-plan-action public-primary">
                    Try KovaGPT
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="public-plan-action public-primary"
                    disabled={busy || !isLoaded}
                    onClick={() => void choosePlan(tier)}
                  >
                    {busy ? "Checking your plan…" : `Get Kova ${plan.name}`}
                  </button>
                )}
                <p className="public-plan-cancel">
                  {tier === "free" ? "No subscription required" : "Cancel through account billing"}
                </p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Check size={18} aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link className="public-plan-details" to={"/help/plans" as never}>
                  View plan details
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="public-plan-grid public-business-plans">
          {(["Team", "Enterprise"] as const).map((name) => (
            <article className="public-plan-card" key={name}>
              <PlanGlyph level={name === "Team" ? 2 : 3} />
              <p className="public-plan-badge">Coming soon</p>
              <h3>{name}</h3>
              <p className="public-plan-description">
                {name === "Team"
                  ? "Discuss your team’s workflow"
                  : "Evaluate your organization’s requirements"}
              </p>
              <p className="public-business-copy">
                {name === "Team"
                  ? "Team subscriptions and shared seat billing are not currently offered for purchase. Tell us how your team would use KovaGPT."
                  : "Enterprise terms, support commitments, and deployment requirements need a scoped review. No compliance certification or service level is promised."}
              </p>
              <ul>
                {(name === "Team"
                  ? [
                      "Discuss account and access needs",
                      "Describe collaboration workflows",
                      "Review availability before adoption",
                    ]
                  : [
                      "Discuss identity and permissions",
                      "Review retention requirements",
                      "Scope procurement and support",
                    ]
                ).map((text) => (
                  <li key={text}>
                    <Check size={18} aria-hidden="true" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="public-plan-action public-primary"
                onClick={() => setContactOpen(true)}
              >
                Contact KovaGPT
              </button>
            </article>
          ))}
        </div>
      )}
      <p className="public-plan-tax">
        Usage limits apply. Prices exclude applicable taxes. Availability depends on your account
        and configured services. Review final terms at checkout.
      </p>
      {error && (
        <p role="alert" className="public-billing-error">
          {error} <Link to="/contact-support">Contact support</Link>
        </p>
      )}
      <Dialog
        open={isOpen && Boolean(owner) && checkoutOwner === owner}
        onOpenChange={(open) => {
          if (!open) closeCheckout();
        }}
      >
        <DialogContent className="public-checkout-dialog">
          <DialogTitle>Secure KovaGPT checkout</DialogTitle>
          <DialogDescription>
            Review your monthly subscription and total before paying. Closing this window does not
            purchase a plan.
          </DialogDescription>
          <div key={owner}>{checkoutElement}</div>
        </DialogContent>
      </Dialog>
      <EnterpriseContactDialog open={contactOpen} onOpenChange={setContactOpen} />
    </section>
  );
}

function PlanGlyph({ level }: { level: number }) {
  return (
    <svg
      className="public-plan-glyph"
      width="58"
      height="64"
      viewBox="0 0 58 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="29" cy="13" r="10" />
      <circle cx="29" cy="13" r="4" />
      <path d="M29 17v43M29 43 12 33m17 10 17-10" />
      <circle cx="11" cy="32" r="4" />
      <circle cx="47" cy="32" r="4" />
      {level > 1 && (
        <>
          <path d="m29 57-17-9m17 9 17-9" />
          <circle cx="11" cy="47" r="4" />
          <circle cx="47" cy="47" r="4" />
        </>
      )}
      {level > 2 && (
        <>
          <path d="m29 29-14-7m14 7 14-7" />
          <circle cx="12" cy="21" r="3" />
          <circle cx="46" cy="21" r="3" />
        </>
      )}
    </svg>
  );
}
