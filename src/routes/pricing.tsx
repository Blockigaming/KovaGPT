import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowLeft, Sparkles, Zap, Crown, X, Building2 } from "lucide-react";
import { useState } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { useUser, useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing - KovaGPT Plus & Pro plans" },
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
      { name: "twitter:description", content: "Compare KovaGPT Free, Plus, and Pro plans." },
      { name: "twitter:image", content: "https://kovagpt.com/og/pricing.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Product",
              name: "KovaGPT Free",
              description: "Free plan with Auto mode, live web search, and image generation.",
              brand: { "@type": "Brand", name: "KovaGPT" },
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                url: "https://kovagpt.com/pricing",
                availability: "https://schema.org/InStock",
              },
            },
            {
              "@type": "Product",
              name: "KovaGPT Plus",
              description:
                "Plus plan with Creative, Precise, Code, and Study modes plus higher usage.",
              brand: { "@type": "Brand", name: "KovaGPT" },
              offers: {
                "@type": "Offer",
                price: "16",
                priceCurrency: "USD",
                url: "https://kovagpt.com/pricing",
                availability: "https://schema.org/InStock",
              },
            },
            {
              "@type": "Product",
              name: "KovaGPT Pro",
              description:
                "Pro plan with Reasoning, Research, Writer Pro, and Tutor Pro modes and top usage limits.",
              brand: { "@type": "Brand", name: "KovaGPT" },
              offers: {
                "@type": "Offer",
                price: "89",
                priceCurrency: "USD",
                url: "https://kovagpt.com/pricing",
                availability: "https://schema.org/InStock",
              },
            },
          ],
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
                text: "Yes. You can cancel from your account settings. Canceling stops future renewals.",
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
                text: "Unused usage does not roll over unless stated otherwise.",
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
            Choose the plan that fits how you work. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <PlanCard
            icon={Sparkles}
            name="Free"
            price="$0"
            period="forever"
            description="Get started with KovaGPT."
            cta="Current plan"
            ctaDisabled
            features={[
              "Access to KovaGPT",
              "Basic Mode",
              "Limited image generations",
              "File & image uploads (daily limit)",
              "Conversation history saved when signed in",
            ]}
          />

          <PlanCard
            icon={Zap}
            name="Plus"
            price="$16"
            period="/ month"
            description="Free for your first month, then $16/month. Cancel anytime."
            cta="Start free month"
            highlight
            onCta={() => startCheckout("plus_monthly")}
            features={[
              "First month free - cancel anytime",
              "Everything in Free",
              "Auto Mode (adapts to your unlocked modes)",
              "Higher daily usage limits",
              "More image generations than Free",
              "More daily file uploads",
              "Creative, Precise, Code & Study modes",
              "Faster response times",
              "Priority access during peak hours",
            ]}
          />

          <PlanCard
            icon={Crown}
            name="Pro"
            price="$89"
            period="/ month"
            description="Maximum capability with exclusive Pro modes."
            cta="Upgrade to Pro"
            onCta={() => startCheckout("pro_monthly")}
            features={[
              "Everything in Plus",
              "Highest KovaGPT usage limits",
              "Reasoning, Research, Writer Pro & Tutor Pro modes",
              "Generate emails, websites & components",
              "Longer context for big documents",
              "Early access to new features",
            ]}
          />

          <PlanCard
            icon={Building2}
            name="Enterprise"
            price="Custom"
            period="annual agreement"
            description="Secure AI for organizations that need governance, support, and predictable scale."
            cta="Contact sales"
            enterprise
            onCta={() => setEnterpriseOpen(true)}
            features={[
              "Everything in Pro",
              "Centralized workspace and consolidated billing",
              "SAML SSO, role controls, and audit logs",
              "Custom retention and data governance",
              "Priority onboarding and support SLA",
              "Volume-based usage and invoicing",
            ]}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Secured by Stripe. Cancel anytime from your account. Enterprise plans are billed manually.
        </p>
      </main>

      <EnterpriseContactDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-10 px-4">
          <div className="relative w-full max-w-2xl bg-background rounded-2xl border border-border overflow-hidden">
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
        Exact usage limits may vary by plan and feature. You can view your current limits from your
        account when signed in.
      </p>

      <section className="mx-auto max-w-5xl px-6 mt-16">
        <h2 className="text-2xl font-semibold mb-6 text-left">Pricing FAQ</h2>
        <div className="grid gap-5 text-sm sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Can I cancel anytime?</h3>
            <p className="text-muted-foreground">
              Yes. You can cancel from your account settings. Canceling stops future renewals.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">What happens if I hit my limit?</h3>
            <p className="text-muted-foreground">
              You can wait until your limit resets or upgrade to a higher plan for more usage.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Can I switch plans?</h3>
            <p className="text-muted-foreground">
              Yes. Manage your subscription from your account settings at any time.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="font-medium mb-1">Do unused credits roll over?</h3>
            <p className="text-muted-foreground">
              Unused usage does not roll over unless stated otherwise.
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
  features: string[];
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
      className={`kova-plan-card relative flex flex-col rounded-[24px] border p-6 shadow-[0_1px_2px_rgb(0_0_0/.04)] ${
        enterprise
          ? "border-foreground/20 bg-foreground text-background"
          : highlight
            ? "border-[var(--kova-blue)] bg-card"
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
            className={`grid h-9 w-9 place-items-center rounded-xl ${enterprise ? "bg-background/15" : "bg-muted"}`}
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
      <p className={`mb-6 text-sm ${enterprise ? "text-background/70" : "text-muted-foreground"}`}>
        {description}
      </p>
      <button
        onClick={onCta}
        disabled={ctaDisabled}
        className={`mb-6 w-full rounded-full py-2.5 text-sm font-medium transition ${
          enterprise
            ? "bg-background text-foreground hover:bg-background/90"
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
