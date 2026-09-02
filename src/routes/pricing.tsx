import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Crown, Sparkles, X, Zap } from "lucide-react";
import { useState } from "react";

import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";
import { useUser, useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

const PRICING_TIERS = ["free", "plus", "pro"] as const;

function displayPrice(monthlyPriceUsd: number): string {
  return monthlyPriceUsd === 0 ? "$0" : `$${monthlyPriceUsd}`;
}

const CUSTOMER_FEATURES = {
  free: [
    "Instant, Medium, and Thinking modes",
    "Core chat with files and images",
    "Search and image creation when available",
    "A simple way to try KovaGPT",
  ],
  plus: [
    "Everything in Free",
    "High mode for harder work",
    "Higher message, upload, and image limits",
    "Deep Research and Adaptive Memory",
  ],
  pro: [
    "Everything in Plus",
    "Extra high and Pro modes",
    "KovaGPT's highest usage limits",
    "Built for heavy daily use",
  ],
} as const;

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Pricing" },
      {
        name: "description",
        content:
          "Compare KovaGPT Free, Plus, and Pro plans for everyday chat, deeper reasoning, research, images, and higher usage.",
      },
      { property: "og:title", content: "KovaGPT Pricing" },
      {
        property: "og:description",
        content: "Compare KovaGPT Free, Plus, and Pro plans.",
      },
      { property: "og:url", content: "https://kovagpt.com/pricing" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/pricing.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT Pricing" },
      { name: "twitter:description", content: "Compare KovaGPT Free, Plus, and Pro plans." },
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
      openSignIn();
      return;
    }
    openCheckout({
      priceId,
      customerEmail: user?.email,
      userId: user?.id,
    });
  };

  const plusTrialDays = CAPABILITY_REGISTRY.plans.plus.trialPeriodDays;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <NovaLogo className="h-6 w-6" />
            <span className="font-semibold tracking-tight">KovaGPT</span>
          </div>
        </div>
      </header>

      <main className="kova-secondary-page kova-pricing-page mx-auto w-full max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <section className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            Plans for every level of use
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Choose how far you want KovaGPT to go
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Start free, move up for more usage and deeper reasoning, or choose Pro for the highest
            limits and most capable modes.
          </p>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3 md:items-stretch lg:gap-5" aria-label="KovaGPT plans">
          <PlanCard
            icon={Sparkles}
            name={CAPABILITY_REGISTRY.plans.free.name}
            eyebrow="Start here"
            price={displayPrice(CAPABILITY_REGISTRY.plans.free.monthlyPriceUsd)}
            period="forever"
            description="For trying KovaGPT and everyday questions."
            cta="Current free plan"
            ctaDisabled
            features={CUSTOMER_FEATURES.free}
          />

          <PlanCard
            icon={Zap}
            name={CAPABILITY_REGISTRY.plans.plus.name}
            eyebrow="Best for most people"
            price={displayPrice(CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd)}
            period="per month"
            description="For regular use, research, and more demanding work."
            cta={plusTrialDays > 0 ? `Start ${plusTrialDays}-day trial` : "Choose Plus"}
            highlight
            onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.plus.lookupKey!)}
            features={CUSTOMER_FEATURES.plus}
          />

          <PlanCard
            icon={Crown}
            name={CAPABILITY_REGISTRY.plans.pro.name}
            eyebrow="Maximum capability"
            price={displayPrice(CAPABILITY_REGISTRY.plans.pro.monthlyPriceUsd)}
            period="per month"
            description="For people who use KovaGPT heavily every day."
            cta="Choose Pro"
            onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.pro.lookupKey!)}
            features={CUSTOMER_FEATURES.pro}
          />
        </section>

        <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
          Search, image generation, and Deep Research depend on their supporting services being
          available. Checkout shows the final price and any trial eligibility before purchase.
        </p>

        <section className="mt-14 rounded-2xl border border-border bg-card/50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-7">
          <div>
            <p className="text-sm font-medium text-muted-foreground">KovaGPT Enterprise</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Need a plan for an organization?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Talk with Kova about security, deployment, support, and commercial requirements before
              anything is purchased.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnterpriseOpen(true)}
            className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border bg-background px-5 text-sm font-medium transition hover:bg-accent sm:mt-0"
          >
            Contact sales
          </button>
        </section>

        <section className="mx-auto mt-16 max-w-4xl">
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Questions before you choose?</h2>
            <p className="mt-2 text-sm text-muted-foreground">The important details, without the fine-print wall.</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <FaqCard
              question="Can I cancel?"
              answer="Use Billing in Settings to manage the options available for your subscription and see when a change takes effect."
            />
            <FaqCard
              question="What happens if I hit a limit?"
              answer="You can wait for the limit to reset or move to a plan with more usage."
            />
            <FaqCard
              question="Can I switch plans?"
              answer="Available plan changes appear in Billing, where the price and timing are shown before you accept."
            />
            <FaqCard
              question="Do unused daily limits roll over?"
              answer="No. Published daily allowances reset rather than accumulating."
            />
          </div>
        </section>
      </main>

      <EnterpriseContactDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <button
              onClick={closeCheckout}
              className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/90 transition hover:bg-accent"
              aria-label="Close checkout"
            >
              <X className="h-4 w-4" />
            </button>
            {checkoutElement}
          </div>
        </div>
      ) : null}

      <PublicFooter />
    </div>
  );
}

type CardProps = {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  eyebrow: string;
  price: string;
  period: string;
  description: string;
  cta: string;
  features: readonly string[];
  highlight?: boolean;
  ctaDisabled?: boolean;
  onCta?: () => void;
};

function PlanCard({
  icon: Icon,
  name,
  eyebrow,
  price,
  period,
  description,
  cta,
  features,
  highlight,
  ctaDisabled,
  onCta,
}: CardProps) {
  return (
    <article
      className={`kova-plan-card relative flex min-h-full flex-col rounded-2xl border p-5 sm:p-6 ${
        highlight
          ? "border-foreground bg-card shadow-[0_18px_55px_-36px_hsl(var(--foreground)/0.55)]"
          : "border-border bg-card/55"
      }`}
    >
      {highlight ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-background">
          Popular
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h2>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted">
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-6 flex min-h-[3.75rem] flex-wrap items-end gap-x-2 gap-y-1">
        <span className="text-4xl font-semibold leading-none tracking-tight">{price}</span>
        <span className="pb-0.5 text-sm text-muted-foreground">{period}</span>
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-muted-foreground">{description}</p>

      <button
        type="button"
        onClick={onCta}
        disabled={ctaDisabled}
        className={`mt-6 min-h-11 w-full rounded-full px-4 text-sm font-semibold transition ${
          highlight
            ? "bg-foreground text-background hover:opacity-90"
            : "border border-border bg-background hover:bg-accent"
        } ${ctaDisabled ? "cursor-default opacity-55" : "active:scale-[0.99]"}`}
      >
        {cta}
      </button>

      <div className="my-6 h-px bg-border/70" />
      <ul className="space-y-3 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 leading-5">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function FaqCard({ question, answer }: { question: string; answer: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card/40 p-5">
      <h3 className="font-medium">{question}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{answer}</p>
    </article>
  );
}
