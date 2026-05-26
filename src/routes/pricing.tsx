import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowLeft, Sparkles, Zap, Crown } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Nova GPT Pricing — Plus & Pro plans" },
      {
        name: "description",
        content:
          "Compare Nova GPT Free, Plus, and Pro plans. Get more messages, image generations, voice, and advanced reasoning.",
      },
    ],
  }),
});

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    icon: Sparkles,
    description: "Get started with Nova GPT.",
    cta: "Current plan",
    highlight: false,
    features: [
      "Access to Nova GPT (Auto mode)",
      "Up to 3 image generations / day",
      "Up to 2 image uploads / day",
      "Voice input & read-aloud",
      "Conversation history saved when signed in",
    ],
  },
  {
    name: "Plus",
    price: "$14",
    period: "/ month",
    icon: Zap,
    description: "More of everything, plus advanced modes.",
    cta: "Upgrade to Plus",
    highlight: true,
    features: [
      "Everything in Free",
      "5x more usage per day",
      "Up to 5x more image generations / day",
      "Unlimited image uploads",
      "Creative, Precise, Code & Study modes",
      "Faster response times",
      "Priority access during peak hours",
    ],
  },
  {
    name: "Pro",
    price: "$79",
    period: "/ month",
    icon: Crown,
    description: "5x more usage than Plus and exclusive Pro modes.",
    cta: "Upgrade to Pro",
    highlight: false,
    features: [
      "Everything in Plus",
      "5x more usage than Plus",
      "Reasoning, Research, Writer Pro & Tutor Pro modes",
      "Generate emails, websites & components",
      "Highest quality voice synthesis",
      "Longer context for big documents",
      "Early access to new features",
    ],
  },
  {
    name: "Pro 10x",
    price: "$149",
    period: "/ month",
    icon: Crown,
    description: "For heavy power users — the highest limits we offer.",
    cta: "Upgrade to Pro 10x",
    highlight: false,
    features: [
      "Everything in Pro",
      "10x more usage than Plus",
      "All Plus and Pro modes included",
      "Top priority during peak hours",
      "Largest context window",
      "Dedicated support",
    ],
  },
];

function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to Nova GPT
          </Link>
          <div className="flex items-center gap-2">
            <NovaLogo className="w-6 h-6" />
            <span className="font-semibold">Nova GPT</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Upgrade your plan
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits how you work. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  plan.highlight
                    ? "border-foreground bg-card shadow-2xl scale-[1.02]"
                    : "border-border bg-card/50"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-foreground text-background text-xs font-semibold">
                    MOST POPULAR
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-5 h-5" />
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground text-sm">{plan.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>
                <button
                  className={`w-full py-2.5 rounded-lg font-medium text-sm transition mb-6 ${
                    plan.highlight
                      ? "bg-foreground text-background hover:opacity-90"
                      : "border border-border hover:bg-accent"
                  }`}
                >
                  {plan.cta}
                </button>
                <ul className="space-y-3 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 mt-0.5 text-foreground shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Payment processing not yet enabled. Buttons are placeholders for now.
        </p>
      </main>
    </div>
  );
}
