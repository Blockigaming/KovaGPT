import "@/components/public/product-showcase.css";
import { createFileRoute } from "@tanstack/react-router";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { PricingPage } from "@/components/public/PricingPlans";

const PRICING_TIERS = ["free", "plus", "pro"] as const;

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
