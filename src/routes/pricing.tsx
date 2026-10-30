import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useUser, useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { PublicShell } from "@/components/public/PublicShell";
import { PlanComparison } from "@/components/public/PlanComparison";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import {
  INTRODUCTORY_OFFER_CHECKOUT_REVIEW,
  INTRODUCTORY_OFFER_HISTORY,
  INTRODUCTORY_OFFER_EXISTING,
  introductoryOfferForTier,
} from "@/lib/introductory-offer";

const PRICING_TIERS = ["free", "plus", "pro"] as const;
const MONTHLY_INTRO_NOTE =
  "Eligible accounts: 50% off the first paid month, once per account. Regular monthly pricing follows.";

function displayPrice(monthlyPriceUsd: number): string {
  return monthlyPriceUsd === 0 ? "$0" : `$${monthlyPriceUsd}`;
}

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Billing" },
      {
        name: "description",
        content:
          "Compare KovaGPT Free, Plus, and Pro plans. Get more messages, image generations and advanced reasoning modes.",
      },
      { property: "og:title", content: "Pricing - KovaGPT Plus & Pro plans" },
      {
        property: "og:description",
        content:
          "Compare KovaGPT Free, Plus, and Pro plans. More messages, image generation and advanced reasoning.",
      },
      { property: "og:url", content: "https://kovagpt.com/pricing" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/pricing.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pricing - KovaGPT Plus & Pro plans" },
      {
        name: "twitter:description",
        content: "Compare KovaGPT Free, Plus, and Pro plans.",
      },
      { name: "twitter:image", content: "https://kovagpt.com/og/pricing.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": PRICING_TIERS.map((tier) => {
            const plan = CAPABILITY_REGISTRY.plans[tier];
            return {
              "@type": "Product",
              name: `KovaGPT ${plan.name}`,
              description: plan.description,
              brand: { "@type": "Brand", name: "KovaGPT" },
              offers: {
                "@type": "Offer",
                price: String(plan.monthlyPriceUsd),
                priceCurrency: "USD",
                url: "https://kovagpt.com/pricing",
                availability: "https://schema.org/InStock",
              },
            };
          }),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Can I cancel anytime?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Open Billing in Settings to see the available subscription-management options and their effective dates.",
              },
            },
            {
              "@type": "Question",
              name: "What happens if I hit my limit?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "You may need to wait until your limit resets or upgrade to a higher plan.",
              },
            },
            {
              "@type": "Question",
              name: "Can I switch plans?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "If plan switching is supported, you can manage your subscription from your account settings.",
              },
            },
            {
              "@type": "Question",
              name: "Do unused credits roll over?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Published daily allowances reset rather than rolling over.",
              },
            },
          ],
        }),
      },
    ],
  }),
});

function PricingPage() {
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const checkoutRegionRef = useRef<HTMLDivElement>(null);
  const checkoutReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const { user, isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();

  useEffect(() => {
    if (!isOpen) {
      setCheckoutStatus("idle");
      return;
    }

    const region = checkoutRegionRef.current;
    if (!region) return;

    const updateStatus = () => {
      const state = region
        .querySelector<HTMLElement>("[data-checkout-state]")
        ?.getAttribute("data-checkout-state");
      if (state === "error") {
        setCheckoutStatus("error");
      } else if (state === "loaded") {
        setCheckoutStatus("loaded");
      } else {
        setCheckoutStatus("loading");
      }
    };

    updateStatus();
    const observer = new MutationObserver(updateStatus);
    observer.observe(region, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-checkout-state"],
    });
    return () => observer.disconnect();
  }, [isOpen]);

  const startCheckout = (priceId: string, trigger: HTMLButtonElement) => {
    if (isLoaded && !isSignedIn) {
      try {
        openSignIn();
      } catch {
        /* clerk not ready */
      }
      return;
    }
    checkoutReturnFocusRef.current = trigger;
    setCheckoutStatus("loading");
    openCheckout({
      priceId,
      customerEmail: user?.email,
      userId: user?.id,
    });
  };

  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        data-ui-reference="chatgpt-pricing"
        className="kova-secondary-page kova-pricing-page mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-6 sm:py-20"
      >
        <section aria-labelledby="pricing-title" className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-semibold text-muted-foreground">Plans and pricing</p>
          <h1
            id="pricing-title"
            className="mb-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl"
          >
            Upgrade your plan
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Choose the plan that fits how you work. Some features depend on connected services.
          </p>
        </section>

        <section
          aria-label="First-month offer"
          className="kova-pricing-offer mx-auto mt-8 max-w-3xl space-y-2 border-y border-border py-4 text-sm leading-6"
        >
          <h2 className="font-semibold">First-month offer</h2>
          <p>{MONTHLY_INTRO_NOTE}</p>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer py-2 text-sm">Offer details and eligibility</summary>
            <div className="space-y-3 pt-2">
              <p>{INTRODUCTORY_OFFER_CHECKOUT_REVIEW}</p>
              <p>{INTRODUCTORY_OFFER_HISTORY}</p>
              <p>{INTRODUCTORY_OFFER_EXISTING}</p>
            </div>
          </details>
        </section>

        <section
          aria-label="KovaGPT plans"
          className="mt-12 grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4"
        >
          <PlanCard
            name={CAPABILITY_REGISTRY.plans.free.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.free.monthlyPriceUsd)}
            period="forever"
            description={CAPABILITY_REGISTRY.plans.free.description}
            cta="Free plan"
            ctaDisabled
            features={CAPABILITY_REGISTRY.plans.free.features}
          />

          <PlanCard
            name={CAPABILITY_REGISTRY.plans.plus.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd)}
            period="/ month"
            taxNotice
            description={CAPABILITY_REGISTRY.plans.plus.description}
            cta="Start Plus"
            highlight
            note={MONTHLY_INTRO_NOTE}
            paymentNote={`If eligible: ${introductoryOfferForTier("plus")!.paymentCopy}`}
            onCta={(event) =>
              startCheckout(CAPABILITY_REGISTRY.plans.plus.lookupKey!, event.currentTarget)
            }
            features={CAPABILITY_REGISTRY.plans.plus.features}
          />

          <PlanCard
            name={CAPABILITY_REGISTRY.plans.pro.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.pro.monthlyPriceUsd)}
            period="/ month"
            taxNotice
            description={CAPABILITY_REGISTRY.plans.pro.description}
            cta="Upgrade to Pro"
            note={MONTHLY_INTRO_NOTE}
            paymentNote={`If eligible: ${introductoryOfferForTier("pro")!.paymentCopy}`}
            onCta={(event) =>
              startCheckout(CAPABILITY_REGISTRY.plans.pro.lookupKey!, event.currentTarget)
            }
            features={CAPABILITY_REGISTRY.plans.pro.features}
          />

          <PlanCard
            name={CAPABILITY_REGISTRY.enterprise.name}
            price={CAPABILITY_REGISTRY.enterprise.priceLabel}
            period="annual agreement"
            description={CAPABILITY_REGISTRY.enterprise.description}
            cta="Contact sales"
            enterprise
            onCta={() => setEnterpriseOpen(true)}
            features={CAPABILITY_REGISTRY.enterprise.features}
          />
        </section>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-6 text-muted-foreground">
          Plus and Pro are eligible for one-shot hosted Agent and approved-public-page Browser tasks
          in Work when the OpenAI service is configured and available. Usage limits apply.
          Interactive Work browser runs are currently unavailable. Paying OpenAI separately does not
          change your Kova plan.
        </p>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
          Stripe hosts checkout. Confirm the introductory discount eligibility, first-month amount,
          regular renewal price and date, tax, and available payment methods before purchase.
        </p>

        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
          Published daily allowances are listed above. Provider outages, maintenance, and account
          eligibility can still limit a feature.
        </p>

        <PlanComparison />

        <section aria-labelledby="pricing-faq-title" className="mt-20 border-t border-border pt-12">
          <h2 id="pricing-faq-title" className="text-2xl font-semibold tracking-[-0.02em]">
            Pricing FAQ
          </h2>
          <div className="mt-7 grid gap-x-10 gap-y-8 text-sm sm:grid-cols-2">
            <article className="border-t border-border pt-5">
              <h3 className="font-medium mb-1">Can I cancel anytime?</h3>
              <p className="leading-6 text-muted-foreground">
                Open Billing in Settings to see the options available for your subscription and when
                a change takes effect.
              </p>
            </article>
            <article className="border-t border-border pt-5">
              <h3 className="font-medium mb-1">What happens if I hit my limit?</h3>
              <p className="leading-6 text-muted-foreground">
                You can wait until your limit resets or upgrade to a higher plan for more usage.
              </p>
            </article>
            <article className="border-t border-border pt-5">
              <h3 className="font-medium mb-1">Can I switch plans?</h3>
              <p className="leading-6 text-muted-foreground">
                Available plan changes appear in Billing. Review the portal or checkout confirmation
                for timing and price before accepting.
              </p>
            </article>
            <article className="border-t border-border pt-5">
              <h3 className="font-medium mb-1">Do unused credits roll over?</h3>
              <p className="leading-6 text-muted-foreground">
                Published daily allowances reset rather than rolling over.
              </p>
            </article>
          </div>
        </section>
      </main>

      <EnterpriseContactDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />

      <Dialog open={isOpen} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:p-0 [&>button]:h-11 [&>button]:w-11"
          onCloseAutoFocus={(event) => {
            const trigger = checkoutReturnFocusRef.current;
            if (!trigger?.isConnected) return;
            event.preventDefault();
            requestAnimationFrame(() => trigger.focus());
          }}
        >
          <DialogHeader className="border-b border-border px-6 py-5 pr-16">
            <DialogTitle>Secure checkout</DialogTitle>
            <DialogDescription>
              Checkout is hosted by Stripe. Review the final terms before purchase.
            </DialogDescription>
          </DialogHeader>
          <p className="sr-only" role="status" aria-live="polite">
            {checkoutStatus === "loading"
              ? "Loading secure checkout"
              : checkoutStatus === "loaded"
                ? "Secure checkout loaded"
                : checkoutStatus === "error"
                  ? "Checkout unavailable"
                  : ""}
          </p>
          <div
            ref={checkoutRegionRef}
            aria-busy={checkoutStatus === "loading"}
            className="max-h-[calc(92dvh-6rem)] overflow-y-auto overscroll-contain"
          >
            {checkoutElement}
          </div>
        </DialogContent>
      </Dialog>
    </PublicShell>
  );
}

type CardProps = {
  name: string;
  price: string;
  period: string;
  description: string;
  note?: string;
  paymentNote?: string;
  cta: string;
  features: readonly string[];
  highlight?: boolean;
  enterprise?: boolean;
  ctaDisabled?: boolean;
  taxNotice?: boolean;
  onCta?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function PlanCard({
  name,
  price,
  period,
  description,
  note,
  paymentNote,
  cta,
  features,
  highlight,
  enterprise,
  ctaDisabled,
  taxNotice,
  onCta,
}: CardProps) {
  return (
    <article
      id={name.toLowerCase()}
      data-pricing-plan={name.toLowerCase()}
      data-ui-reference="chatgpt-pricing-plan-card"
      className={`kova-plan-card relative grid rounded-2xl md:row-span-6 md:h-full md:grid-rows-subgrid border p-6 ${
        enterprise
          ? "border-foreground/25 bg-card"
          : highlight
            ? "border-foreground bg-card"
            : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-medium">{name}</h2>
      </div>
      <div className="flex flex-col justify-start md:min-h-[3.25rem]">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-[40px] font-medium leading-[48px]">{price}</span>
          <span className="text-sm leading-5 text-muted-foreground">{period}</span>
        </div>
        {taxNotice ? (
          <span className="mt-1 text-xs leading-4 text-muted-foreground">+ applicable tax</span>
        ) : null}
      </div>
      <p className="text-sm leading-6 text-muted-foreground md:pt-2">
        {description}
        {note ? <span className="mt-1 block text-xs leading-5">{note}</span> : null}
        {paymentNote ? <span className="mt-1 block text-xs leading-5">{paymentNote}</span> : null}
      </p>
      <button
        type="button"
        onClick={onCta}
        disabled={ctaDisabled}
        className={`inline-flex h-11 w-full items-center justify-center rounded-full border px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          highlight
            ? "border-foreground bg-foreground text-background hover:opacity-90"
            : enterprise
              ? "border-foreground/40 hover:bg-accent"
              : "border-border hover:bg-accent"
        } ${ctaDisabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {cta}
      </button>
      <div className="my-auto h-px bg-border" aria-hidden="true" />
      <ul className="flex min-h-0 flex-col gap-3 text-sm md:justify-around md:pt-4">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
