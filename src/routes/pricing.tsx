import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowLeft, Sparkles, Zap, Crown, X, Building2 } from "lucide-react";
import { useState } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { useUser, useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { PublicFooter } from "@/components/PublicFooter";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

const PRICING_TIERS = ["free", "plus", "pro"] as const;

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
  const { user, isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();

  const startCheckout = (priceId: string) => {
    if (isLoaded && !isSignedIn) {
      try {
        openSignIn();
      } catch {
        /* clerk not ready */
      }
      return;
    }
    openCheckout({
      priceId,
      customerEmail: user?.email,
      userId: user?.id,
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to KovaGPT
          </Link>
          <div className="flex items-center gap-2">
            <NovaLogo className="w-6 h-6" />
            <span className="font-semibold">KovaGPT</span>
          </div>
        </div>
      </header>

      <main className="kova-secondary-page kova-pricing-page max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Upgrade your plan</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits how you work. Provider-dependent features require their
            services to be configured and available.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <PlanCard
            icon={Sparkles}
            name={CAPABILITY_REGISTRY.plans.free.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.free.monthlyPriceUsd)}
            period="forever"
            description={CAPABILITY_REGISTRY.plans.free.description}
            cta="Free plan"
            ctaDisabled
            features={CAPABILITY_REGISTRY.plans.free.features}
          />

          <PlanCard
            icon={Zap}
            name={CAPABILITY_REGISTRY.plans.plus.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd)}
            period="/ month"
            description={`Eligible first-time subscribers may receive a ${CAPABILITY_REGISTRY.plans.plus.trialPeriodDays}-day trial. Checkout confirms eligibility and price before purchase.`}
            cta="Start Plus"
            highlight
            onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.plus.lookupKey!)}
            features={CAPABILITY_REGISTRY.plans.plus.features}
          />

          <PlanCard
            icon={Crown}
            name={CAPABILITY_REGISTRY.plans.pro.name}
            price={displayPrice(CAPABILITY_REGISTRY.plans.pro.monthlyPriceUsd)}
            period="/ month"
            description={CAPABILITY_REGISTRY.plans.pro.description}
            cta="Upgrade to Pro"
            onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.pro.lookupKey!)}
            features={CAPABILITY_REGISTRY.plans.pro.features}
          />

          <PlanCard
            icon={Building2}
            name={CAPABILITY_REGISTRY.enterprise.name}
            price={CAPABILITY_REGISTRY.enterprise.priceLabel}
            period="annual agreement"
            description={CAPABILITY_REGISTRY.enterprise.description}
            cta="Contact sales"
            enterprise
            onCta={() => setEnterpriseOpen(true)}
            features={CAPABILITY_REGISTRY.enterprise.features}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Stripe hosts checkout. Confirm the price, trial eligibility, renewal date, and available
          payment methods before purchase.
        </p>
      </main>

      <EnterpriseContactDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto py-10 px-4">
          <div className="relative w-full max-w-2xl bg-background rounded-xl border border-border overflow-hidden">
            <button
              onClick={closeCheckout}
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-background/80 border border-border hover:bg-accent transition"
              aria-label="Close checkout"
            >
              <X className="w-4 h-4" />
            </button>
            {checkoutElement}
          </div>
        </div>
      )}
      <p className="mx-auto max-w-5xl px-6 mt-10 text-xs text-muted-foreground">
        Published daily allowances are listed above. Provider outages, maintenance, and account
        eligibility can still limit a feature.
      </p>

      <section className="mx-auto max-w-5xl px-6 mt-16">
        <h2 className="text-2xl font-semibold mb-6 text-left">Pricing FAQ</h2>
        <div className="grid gap-5 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Can I cancel anytime?</h3>
            <p className="text-muted-foreground">
              Open Billing in Settings to see the options available for your subscription and when a
              change takes effect.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">What happens if I hit my limit?</h3>
            <p className="text-muted-foreground">
              You can wait until your limit resets or upgrade to a higher plan for more usage.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Can I switch plans?</h3>
            <p className="text-muted-foreground">
              Available plan changes appear in Billing. Review the portal or checkout confirmation
              for timing and price before accepting.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Do unused credits roll over?</h3>
            <p className="text-muted-foreground">
              Published daily allowances reset rather than rolling over.
            </p>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

type CardProps = {
  icon?: React.ComponentType<{ className?: string }>;
  name: string;
  price: string;
  period: string;
  description: string;
  cta: string;
  features: readonly string[];
  highlight?: boolean;
  enterprise?: boolean;
  ctaDisabled?: boolean;
  onCta?: () => void;
};

function PlanCard({
  icon: Icon,
  name,
  price,
  period,
  description,
  cta,
  features,
  highlight,
  enterprise,
  ctaDisabled,
  onCta,
}: CardProps) {
  return (
    <div
      className={`kova-plan-card relative flex flex-col rounded-xl border p-6 shadow-none ${
        enterprise
          ? "border-foreground/30 bg-card"
          : highlight
            ? "border-foreground bg-card"
            : "border-border bg-card/50"
      }`}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-foreground text-background text-xs font-semibold">
          MOST POPULAR
        </div>
      )}
      <div className="mb-3 flex items-center gap-2.5">
        {Icon ? (
          <span
            className={`grid h-9 w-9 place-items-center rounded-xl bg-muted`}
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <h2 className="text-xl font-semibold">{name}</h2>
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-4xl font-bold">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {description}
      </p>
      <button
        onClick={onCta}
        disabled={ctaDisabled}
        className={`mb-6 w-full rounded-full py-2.5 text-sm font-medium transition ${
          enterprise
            ? "border border-foreground/40 hover:bg-accent"
            : highlight
              ? "bg-foreground text-background hover:opacity-90"
              : "border border-border hover:bg-accent"
        } ${ctaDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {cta}
      </button>
      <ul className="space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="w-4 h-4 mt-0.5 text-foreground shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
