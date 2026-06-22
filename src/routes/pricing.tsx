import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowLeft, Sparkles, Zap, Crown, X } from "lucide-react";
import { useState } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { useUser } from "@/components/auth/ClerkSafe";
import { useClerk } from "@clerk/clerk-react";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";



export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing — NovaGPT Plus & Pro plans" },
      {
        name: "description",
        content:
          "Compare NovaGPT Free, Plus, and Pro plans. Get more messages, image generations, voice, and advanced reasoning modes.",
      },
      { property: "og:title", content: "Pricing — NovaGPT Plus & Pro plans" },
      {
        property: "og:description",
        content:
          "Compare NovaGPT Free, Plus, and Pro plans. More messages, image generation, voice, and advanced reasoning.",
      },
      { property: "og:url", content: "https://nova-aigpt.lovable.app/pricing" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://nova-aigpt.lovable.app/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Product",
              name: "NovaGPT Free",
              description: "Free plan with Auto mode, live web search, and image generation.",
              brand: { "@type": "Brand", name: "NovaGPT" },
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                url: "https://nova-aigpt.lovable.app/pricing",
                availability: "https://schema.org/InStock",
              },
            },
            {
              "@type": "Product",
              name: "NovaGPT Plus",
              description: "Plus plan with Creative, Precise, Code, and Study modes plus higher usage.",
              brand: { "@type": "Brand", name: "NovaGPT" },
              offers: {
                "@type": "Offer",
                price: "20",
                priceCurrency: "USD",
                url: "https://nova-aigpt.lovable.app/pricing",
                availability: "https://schema.org/InStock",
              },
            },
            {
              "@type": "Product",
              name: "NovaGPT Pro",
              description: "Pro plan with Reasoning, Research, Writer Pro, and Tutor Pro modes and top usage limits.",
              brand: { "@type": "Brand", name: "NovaGPT" },
              offers: {
                "@type": "Offer",
                price: "79",
                priceCurrency: "USD",
                url: "https://nova-aigpt.lovable.app/pricing",
                availability: "https://schema.org/InStock",
              },
            },
          ],
        }),
      },
    ],
  }),
});


type ProTier = "5x" | "10x";

const PRO_TIERS: Record<ProTier, { price: string; usage: string; cta: string; priceId: string }> = {
  "5x": { price: "$79", usage: "5x more usage than Plus", cta: "Upgrade to Pro 5x", priceId: "pro_5x_monthly" },
  "10x": { price: "$149", usage: "10x more usage than Plus", cta: "Upgrade to Pro 10x", priceId: "pro_10x_monthly" },
};

function PricingPage() {
  const [proTier, setProTier] = useState<ProTier>("5x");
  const pro = PRO_TIERS[proTier];
  const { user, isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();

  const startCheckout = (priceId: string) => {
    // If Clerk has loaded and the user isn't signed in, require auth.
    // If Clerk hasn't loaded (e.g. preview/offline), fall back to guest
    // checkout so payments are never blocked by auth issues.
    if (isLoaded && !isSignedIn) {
      try { openSignIn(); } catch { /* clerk not ready */ }
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
      <PaymentTestModeBanner />
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to NovaGPT
          </Link>
          <div className="flex items-center gap-2">
            <NovaLogo className="w-6 h-6" />
            <span className="font-semibold">NovaGPT</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Upgrade your plan</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits how you work. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Free */}
          <PlanCard
            icon={Sparkles}
            name="Free"
            price="$0"
            period="forever"
            description="Get started with NovaGPT."
            cta="Current plan"
            ctaDisabled
            features={[
              "Access to NovaGPT (Auto mode)",
              "Up to 3 image generations / day",
              "Up to 2 image uploads / day",
              "Voice input & read-aloud",
              "Conversation history saved when signed in",
            ]}
          />

          {/* Plus */}
          <PlanCard
            icon={Zap}
            name="Plus"
            price="$14"
            period="/ month"
            description="More of everything, plus advanced modes."
            cta="Upgrade to Plus"
            highlight
            onCta={() => startCheckout("plus_monthly")}
            features={[
              "Everything in Free",
              "5x more usage per day",
              "Up to 5x more image generations / day",
              "Unlimited image uploads",
              "Creative, Precise, Code & Study modes",
              "Faster response times",
              "Priority access during peak hours",
            ]}
          />

          {/* Pro */}
          <div className="relative rounded-2xl border border-border bg-card/50 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-5 h-5" />
              <h2 className="text-xl font-semibold">Pro</h2>
            </div>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-4xl font-bold">{pro.price}</span>
              <span className="text-muted-foreground text-sm">/ month</span>
            </div>

            <div className="inline-flex p-1 rounded-lg bg-accent/50 border border-border mb-4 self-start">
              {(["5x", "10x"] as ProTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setProTier(t)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    proTier === t
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t} usage
                </button>
              ))}
            </div>

            <p className="text-sm text-muted-foreground mb-6">
              Maximum capability with exclusive Pro modes.
            </p>
            <button
              onClick={() => startCheckout(pro.priceId)}
              className="w-full py-2.5 rounded-lg font-medium text-sm transition mb-6 border border-border hover:bg-accent"
            >
              {pro.cta}
            </button>
            <ul className="space-y-3 text-sm">
              {[
                "Everything in Plus",
                pro.usage,
                "Reasoning, Research, Writer Pro & Tutor Pro modes",
                "Generate emails, websites & components",
                "Highest quality voice synthesis",
                "Longer context for big documents",
                "Early access to new features",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 text-foreground shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Secured by Stripe. Cancel anytime from your account.
        </p>
      </main>

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
    </div>
  );
}

type CardProps = {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  price: string;
  period: string;
  description: string;
  cta: string;
  features: string[];
  highlight?: boolean;
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
  ctaDisabled,
  onCta,
}: CardProps) {
  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col ${
        highlight ? "border-foreground bg-card shadow-2xl scale-[1.02]" : "border-border bg-card/50"
      }`}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-foreground text-background text-xs font-semibold">
          MOST POPULAR
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" />
        <h2 className="text-xl font-semibold">{name}</h2>
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-4xl font-bold">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{description}</p>
      <button
        onClick={onCta}
        disabled={ctaDisabled}
        className={`w-full py-2.5 rounded-lg font-medium text-sm transition mb-6 ${
          highlight
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
