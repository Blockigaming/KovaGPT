import { PublicShell } from "@/components/public/PublicShell";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { PlanComparison } from "@/components/public/PlanComparison";
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
                text: "Open Subscriptions in Settings to review cancellation and subscription-management options in Stripe.",
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
                text: "Choose a plan on Pricing, then review the supported plan change and renewal details securely in Stripe.",
              },
            },
            {
              "@type": "Question",
              name: "Do unused credits roll over?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Unused allowances do not roll over. Reset schedules appear in Usage.",
              },
            },
          ],
        }),
      },
    ],
  }),
});

function PricingPage() {
  const [planType, setPlanType] = useState<"individual" | "organizations">("individual");
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [phonePlan, setPhonePlan] = useState<(typeof PRICING_TIERS)[number]>("plus");
  useEffect(() => {
    const selectFromHash = () => {
      const hash = window.location.hash.slice(1);
      const tier = PRICING_TIERS.find((candidate) => candidate === hash);
      if (tier) setPhonePlan(tier);
    };
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, []);
  const navigate = useNavigate();
  const startCheckout = (priceId: string) => {
    void navigate({ to: "/subscribe" as never, search: { plan: priceId } as never });
  };

  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        data-billing-page
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
          <div
            role="group"
            aria-label="Plan types"
            className="mx-auto mt-6 inline-flex gap-1 rounded-full bg-muted p-1"
          >
            {(
              [
                ["individual", "Individual"],
                ["organizations", "Teams & Enterprise"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={planType === value}
                onClick={() => setPlanType(value)}
                className="rounded-full px-4 py-2 text-sm font-medium transition-colors hover:bg-background/60 aria-pressed:bg-background sm:px-6"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {planType === "individual" ? (
          <>
            <div className="kova-phone-plan-picker hidden" role="group" aria-label="Choose a plan">
              {PRICING_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  aria-controls={tier}
                  aria-pressed={phonePlan === tier}
                  onClick={() => setPhonePlan(tier)}
                >
                  {CAPABILITY_REGISTRY.plans[tier].name}
                </button>
              ))}
            </div>
            <section
              aria-label="KovaGPT plans"
              data-phone-selected-plan={phonePlan}
              className="kova-individual-plans mt-12 grid items-stretch gap-5 md:grid-cols-3"
            >
              <PlanCard
                name="Kova Free"
                planId="free"
                price={displayPrice(CAPABILITY_REGISTRY.plans.free.monthlyPriceUsd)}
                period="forever"
                description={CAPABILITY_REGISTRY.plans.free.description}
                cta="Free plan"
                ctaDisabled
                features={CAPABILITY_REGISTRY.plans.free.features}
              />

              <PlanCard
                name="Kova Plus"
                planId="plus"
                price={displayPrice(CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd)}
                period="/ month"
                taxNotice
                description={CAPABILITY_REGISTRY.plans.plus.description}
                cta="Start Plus"
                highlight
                onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.plus.lookupKey!)}
                features={CAPABILITY_REGISTRY.plans.plus.features}
              />

              <PlanCard
                name="Kova Pro"
                planId="pro"
                price={displayPrice(CAPABILITY_REGISTRY.plans.pro.monthlyPriceUsd)}
                period="/ month"
                taxNotice
                description={CAPABILITY_REGISTRY.plans.pro.description}
                cta="Upgrade to Pro"
                onCta={() => startCheckout(CAPABILITY_REGISTRY.plans.pro.lookupKey!)}
                features={CAPABILITY_REGISTRY.plans.pro.features}
              />
            </section>
            <PlanComparison />
            <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
              Stripe hosts checkout. Review your payment, renewal price, tax, and available payment
              methods before purchase.
            </p>
          </>
        ) : (
          <OrganizationPlans onContact={() => setEnterpriseOpen(true)} />
        )}

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
                Free and Plus chat stops when your allowance is used. Pro includes unlimited basic
                chat with Argon Lite; advanced model usage is limited. Wait for a reset or choose an
                eligible plan for more usage.
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
                Unused allowances do not roll over. Reset schedules appear in Usage.
              </p>
            </article>
          </div>
        </section>
      </main>

      <EnterpriseContactDialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen} />
    </PublicShell>
  );
}

type CardProps = {
  name: string;
  planId: string;
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
  planId,
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
      id={planId}
      data-pricing-plan={planId}
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

const teamTopics = [
  "Central billing and administration",
  "Single sign-on",
  "Organization-wide search",
  "Microsoft 365 and connector controls",
  "Managed desktop deployment",
  "Mixing standard and premium seats",
];
const enterpriseTopics = [
  "User and organization spend limits",
  "Role-based permissions and SCIM",
  "Audit logs and compliance reporting",
  "Custom data retention",
  "Network access controls and IP allowlisting",
  "Security and healthcare compliance requirements",
];

function OrganizationPlans({ onContact }: { onContact: () => void }) {
  return (
    <section className="mt-12" aria-labelledby="organization-plans-title">
      <h2 id="organization-plans-title" className="text-center text-3xl font-semibold">
        Plans that grow with you
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
        Choose Team seats directly, or contact sales for Enterprise.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <article className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-6">
          <div>
            <p className="text-sm text-muted-foreground">2–150 users</p>
            <h3 className="mt-1 text-2xl font-semibold">Team</h3>
            <p className="mt-1 text-muted-foreground">Predictable usage per seat</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                name: "Standard seat",
                annual: 20,
                monthly: 25,
                description: "All Kova models with shared team billing",
              },
              {
                name: "Premium seat",
                annual: 100,
                monthly: 125,
                description: "5× Standard metered usage",
              },
            ].map(({ name, annual, monthly, description }) => (
              <div key={name} className="rounded-2xl bg-muted p-4 text-left">
                <h4 className="font-medium">{name}</h4>
                <p className="mt-2">
                  <strong className="text-2xl">${annual}</strong> / seat / mo
                </p>
                <p className="text-xs text-muted-foreground">Billed annually</p>
                <p className="mt-2 text-sm">${monthly} / seat / mo when billed monthly</p>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <p className="text-left text-sm text-muted-foreground">
            Buy seats, invite verified accounts, and manage billing in your Team workspace.
          </p>
          <Link
            to="/team"
            className="mt-auto inline-flex min-h-11 items-center justify-center rounded-full border border-border px-5 font-medium hover:bg-accent"
          >
            Get Team
          </Link>
        </article>
        <article className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-6">
          <div>
            <p className="text-sm text-muted-foreground">20+ users</p>
            <h3 className="mt-1 text-2xl font-semibold">Enterprise</h3>
            <p className="mt-1 text-muted-foreground">Flexible pooled usage</p>
          </div>
          <div className="rounded-2xl bg-muted p-4 text-left">
            <p className="text-lg font-semibold">Seat price + usage at API rates</p>
            <p className="mt-2 text-sm text-muted-foreground">
              $20 per seat per month plus tax, billed annually. Usage costs vary by model and task.
            </p>
          </div>
          <OrganizationTopics topics={enterpriseTopics} />
          <button
            type="button"
            onClick={onContact}
            className="mt-auto min-h-11 rounded-full border border-border px-5 font-medium hover:bg-accent"
          >
            Contact sales about Enterprise
          </button>
        </article>
      </div>
    </section>
  );
}

function OrganizationTopics({ topics }: { topics: readonly string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">Discuss with sales</h4>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {topics.map((topic) => (
          <li key={topic}>{topic}</li>
        ))}
      </ul>
    </div>
  );
}
