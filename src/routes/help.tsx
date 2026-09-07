import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, LifeBuoy, Mail, Loader2, ChevronDown, ArrowLeft, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "KovaGPT Help" },
      {
        name: "description",
        content:
          "Search KovaGPT FAQs on accounts, billing, apps, images, projects, and more. Contact support if you need a hand.",
      },
      { property: "og:title", content: "Help Center - KovaGPT" },
      {
        property: "og:description",
        content: "Search KovaGPT FAQs and contact support.",
      },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/help" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }),
      },
    ],
  }),
  component: HelpPage,
});

type Faq = {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
};

const FEATURES = CAPABILITY_REGISTRY.features;
const FREE_MODES = CAPABILITY_REGISTRY.modesByTier.free.map((mode) => mode.label).join(", ");
const PLUS_MODES = CAPABILITY_REGISTRY.modesByTier.plus.map((mode) => mode.label).join(", ");
const PRO_MODES = CAPABILITY_REGISTRY.modesByTier.pro.map((mode) => mode.label).join(", ");
const WORKING_APPS = CAPABILITY_REGISTRY.workingApps.join(", ");

const CATEGORIES = [
  "Accounts",
  "Sign-in",
  "Google",
  "Gmail",
  "Calendar",
  "Apps",
  "Billing",
  "Trials",
  "Subscriptions",
  "Cancellations",
  "Refunds",
  "Privacy",
  "Security",
  "Getting started",
  "Chat basics",
  "Search",
  "Deep Research",
  "Files",
  "Data analysis",
  "Canvas",
  "Temporary Chat",
  "Memory",
  "Sharing and collaboration",
  "Account and security",
  "Billing and usage",
  "Images",
  "Projects",
  "Library",
  "Scheduled tasks",
  "Troubleshooting",
] as const;

const FAQS: Faq[] = [
  {
    id: "start-1",
    category: "Getting started",
    question: "What should I try first in KovaGPT?",
    answer: `Start with Medium chat, create a Project for ongoing work, and explicitly save reusable items to Library. ${FEATURES.webSearch.summary} ${FEATURES.deepResearch.summary}`,
    keywords: ["getting started", "first run", "onboarding"],
  },
  {
    id: "chat-1",
    category: "Chat basics",
    question: "How do I choose the right chat mode?",
    answer: `Free includes ${FREE_MODES}. Plus includes ${PLUS_MODES}. Pro includes ${PRO_MODES}. Search, Deep Research, Images, and Temporary Chat are separate composer tools with their own availability rules.`,
    keywords: ["chat", "mode", "temporary"],
  },
  {
    id: "search-1",
    category: "Search",
    question: "When should I enable Search?",
    answer: `${FEATURES.webSearch.summary} ${FEATURES.webSearch.limitation}`,
    keywords: ["web", "sources", "citations"],
  },
  {
    id: "research-1",
    category: "Deep Research",
    question: "What does Deep Research do?",
    answer: `${FEATURES.deepResearch.summary} ${FEATURES.deepResearch.limitation}`,
    keywords: ["research", "report", "sources"],
  },
  {
    id: "files-1",
    category: "Files",
    question: "What files can KovaGPT understand?",
    answer: `${FEATURES.attachments.summary} ${FEATURES.attachments.limitation}`,
    keywords: ["upload", "pdf", "csv", "documents"],
  },
  {
    id: "analysis-1",
    category: "Data analysis",
    question: "Can KovaGPT analyze spreadsheets?",
    answer: `${FEATURES.dataAnalysis.summary} ${FEATURES.dataAnalysis.limitation}`,
    keywords: ["spreadsheet", "csv", "chart", "analysis"],
  },
  {
    id: "canvas-1",
    category: "Canvas",
    question: "When should I use Canvas?",
    answer: `${FEATURES.canvas.summary} ${FEATURES.canvas.limitation}`,
    keywords: ["document", "artifact", "version"],
  },
  {
    id: "memory-1",
    category: "Memory",
    question: "How does Memory work?",
    answer: FEATURES.memory.summary,
    keywords: ["preferences", "remember", "forget"],
  },
  {
    id: "acc-1",
    category: "Accounts",
    question: "How do I create a KovaGPT account?",
    answer:
      "Click Sign in at the top right and choose Continue with Google or use your email. Your account is created automatically the first time you sign in.",
    keywords: ["signup", "register", "new account", "create"],
  },
  {
    id: "acc-2",
    category: "Accounts",
    question: "How do I change my display name or avatar?",
    answer:
      "Open Settings → Account. Update your name and profile picture there. Changes save automatically.",
    keywords: ["profile", "name", "picture"],
  },
  {
    id: "acc-3",
    category: "Accounts",
    question: "How do I delete my account?",
    answer:
      "Use Delete account in Settings and wait for the success confirmation. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.",
    keywords: ["delete", "remove", "close account"],
  },
  {
    id: "sign-1",
    category: "Sign-in",
    question: "I can't sign in - what should I try?",
    answer:
      "Try a hard refresh, clear cookies for kovagpt.com, and use an incognito window. If Google sign-in fails, make sure pop-ups aren't blocked.",
    keywords: ["login", "cant login", "auth", "locked out"],
  },
  {
    id: "sign-2",
    category: "Sign-in",
    question: "I didn't receive the magic link email.",
    answer:
      "Check spam and Promotions. If the link is expired or missing, request a new one from the sign-in screen.",
    keywords: ["magic link", "email link", "no email"],
  },
  {
    id: "sign-3",
    category: "Sign-in",
    question: "How do I reset my password?",
    answer: "On the sign-in screen click 'Forgot password'. We'll email you a secure reset link.",
    keywords: ["password", "reset", "forgot"],
  },
  {
    id: "goog-1",
    category: "Google",
    question: "How do I connect my Google account?",
    answer:
      "Open Apps, choose Google, and review the provider's consent screen before approving access.",
    keywords: ["oauth", "connect google", "link google"],
  },
  {
    id: "goog-2",
    category: "Google",
    question: "What Google permissions does KovaGPT request?",
    answer:
      "The Google consent screen lists the exact scopes requested for the services you connect. Approve only scopes you understand; you can disconnect from Apps or your Google account.",
    keywords: ["permissions", "scopes", "privacy"],
  },
  {
    id: "gmail-1",
    category: "Gmail",
    question: "How does Gmail integration work?",
    answer:
      "Open Apps to see whether Gmail is connected and which access is enabled. Available operations depend on granted scopes, configured credentials, and service availability.",
    keywords: ["email", "inbox", "draft"],
  },
  {
    id: "cal-1",
    category: "Calendar",
    question: "Can KovaGPT create calendar events?",
    answer:
      "Open Apps to connect Google Calendar and review the granted scopes. Calendar operations are available only when the connection and requested action are supported.",
    keywords: ["schedule", "meeting", "event"],
  },
  {
    id: "apps-1",
    category: "Apps",
    question: "Which apps can I connect?",
    answer: `The working Apps page currently lists ${WORKING_APPS}. ${FEATURES.apps.limitation}`,
    keywords: ["integrations", "connectors", "connect"],
  },
  {
    id: "apps-2",
    category: "Apps",
    question: "How do I disconnect an app?",
    answer:
      "Open Apps, choose the connected service, and use its disconnect control. The page reports whether the operation succeeded.",
    keywords: ["revoke", "remove", "disconnect"],
  },
  {
    id: "bill-1",
    category: "Billing",
    question: "Where do I manage my subscription?",
    answer:
      "Open Settings → Subscription to view plan, invoices, and payment method. You can also open the Stripe customer portal from there.",
    keywords: ["invoice", "payment", "receipt", "stripe"],
  },
  {
    id: "bill-2",
    category: "Billing",
    question: "What payment methods do you accept?",
    answer:
      "Stripe hosts checkout and shows the payment methods available for your account, device, and region before purchase.",
    keywords: ["card", "apple pay", "google pay"],
  },
  {
    id: "trial-1",
    category: "Trials",
    question: "How does the free trial work?",
    answer: `Eligible first-time Plus subscribers may receive a ${CAPABILITY_REGISTRY.plans.plus.trialPeriodDays}-day trial. Checkout confirms eligibility, price, and renewal timing before purchase.`,
    keywords: ["free", "1 month", "trial"],
  },
  {
    id: "sub-1",
    category: "Subscriptions",
    question: "What's included in KovaGPT Plus?",
    answer: `${CAPABILITY_REGISTRY.plans.plus.features.join(". ")}. ${FEATURES.scheduledTasks.summary}`,
    keywords: ["plus", "pro", "features", "premium"],
  },
  {
    id: "sub-2",
    category: "Subscriptions",
    question: "Can I upgrade or downgrade any time?",
    answer:
      "Available plan changes appear in Billing. Review the portal or checkout confirmation for timing and price before accepting.",
    keywords: ["upgrade", "downgrade", "plan change"],
  },
  {
    id: "can-1",
    category: "Cancellations",
    question: "How do I cancel my subscription?",
    answer:
      "Settings → Subscription → Manage subscription → Cancel. You keep access until the end of the current period.",
    keywords: ["cancel", "stop", "end plan"],
  },
  {
    id: "ref-1",
    category: "Refunds",
    question: "Do you offer refunds?",
    answer:
      "Review the current Refund Policy for eligibility and contact support@kovagpt.com with the account email and purchase details.",
    keywords: ["money back", "refund policy"],
  },
  {
    id: "priv-1",
    category: "Privacy",
    question: "Do you train on my chats?",
    answer:
      "Review the Privacy Policy for KovaGPT's handling and the terms of any configured AI provider. Do not rely on a Help Center summary for a legal data-use promise.",
    keywords: ["training", "data", "gdpr"],
  },
  {
    id: "priv-2",
    category: "Privacy",
    question: "How do I export my data?",
    answer:
      "Use an available export control in Settings, or contact support if it is unavailable. Wait for a completed export before assuming all data was included.",
    keywords: ["export", "download", "gdpr"],
  },
  {
    id: "sec-1",
    category: "Security",
    question: "Is my data encrypted?",
    answer:
      "KovaGPT uses configured hosting, authentication, storage, and integration providers. Review the Security and Privacy pages for the current controls and avoid assuming a specific cipher covers every provider.",
    keywords: ["encryption", "tls", "aes"],
  },
  {
    id: "sec-2",
    category: "Security",
    question: "Do you support two-factor authentication?",
    answer: FEATURES.mfa.summary,
    keywords: ["2fa", "mfa", "two factor"],
  },
  {
    id: "img-1",
    category: "Images",
    question: "How do I generate an image?",
    answer:
      "Open the Images tab, describe what you want in the composer, and pick a style preset if you like.",
    keywords: ["image", "generate", "dalle", "create image"],
  },
  {
    id: "img-2",
    category: "Images",
    question: "Can I edit an image I generated?",
    answer: FEATURES.imageEditing.summary,
    keywords: ["edit image", "variant", "inpaint"],
  },
  {
    id: "proj-1",
    category: "Projects",
    question: "What are Projects?",
    answer:
      "Workspaces that group chats, files, images, notes, tasks, memory, and custom instructions around a topic.",
    keywords: ["workspace", "folder", "organize"],
  },
  {
    id: "proj-2",
    category: "Projects",
    question: "Can I share a project?",
    answer: "Invite collaborators from the Members tab in any project you own.",
    keywords: ["share", "collaborate", "invite"],
  },
  {
    id: "lib-1",
    category: "Library",
    question: "Where do my saved chats go?",
    answer: `${FEATURES.library.summary} ${FEATURES.cloudHistory.summary}`,
    keywords: ["history", "saved chats", "search"],
  },
  {
    id: "task-1",
    category: "Scheduled tasks",
    question: "Why can't I create a scheduled task?",
    answer: FEATURES.scheduledTasks.summary,
    keywords: ["reminder", "cron", "recurring"],
  },
  {
    id: "trouble-1",
    category: "Troubleshooting",
    question: "The app is slow or unresponsive.",
    answer:
      "Refresh the page, close unused tabs, and check your network. If issues persist, try a different browser or contact support.",
    keywords: ["slow", "lag", "frozen", "bug"],
  },
  {
    id: "trouble-2",
    category: "Troubleshooting",
    question: "Messages fail to send.",
    answer:
      "Check your connection and current daily allowance. Every published plan has finite limits; wait for reset or compare the higher allowances on Pricing.",
    keywords: ["error", "failed", "not sending"],
  },
];

function scoreFaq(faq: Faq, q: string): number {
  if (!q) return 0;
  const query = q.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const hay =
    `${faq.question} ${faq.answer} ${faq.category} ${faq.keywords.join(" ")}`.toLowerCase();
  let score = 0;
  if (faq.question.toLowerCase() === query) score += 100;
  if (faq.question.toLowerCase().includes(query)) score += 40;
  if (faq.category.toLowerCase() === query) score += 30;
  for (const t of terms) {
    if (faq.question.toLowerCase().includes(t)) score += 8;
    if (faq.keywords.some((k) => k.toLowerCase().includes(t))) score += 6;
    if (faq.answer.toLowerCase().includes(t)) score += 3;
    if (faq.category.toLowerCase().includes(t)) score += 4;
    if (!hay.includes(t)) score -= 20;
  }
  return score;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    ),
  );
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) ? (
          <mark
            key={i}
            className="bg-yellow-200/60 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function HelpPage() {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    let list = FAQS;
    if (activeCat) list = list.filter((f) => f.category === activeCat);
    if (!query.trim()) return list;
    return list
      .map((f) => ({ f, s: scoreFaq(f, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.f);
  }, [query, activeCat]);

  const suggestions = useMemo(() => {
    if (results.length > 0 || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return FAQS.map((f) => {
      const hay = `${f.question} ${f.keywords.join(" ")}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t.slice(0, Math.max(3, t.length - 1)))).length;
      return { f, hits };
    })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5)
      .map((x) => x.f);
  }, [query, results.length]);

  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <a
            href="mailto:support@kovagpt.com"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <Mail className="w-4 h-4" /> support@kovagpt.com
          </a>
        </div>

        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-xs text-muted-foreground">
            <LifeBuoy className="w-3.5 h-3.5" /> KovaGPT Help Center
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">How can we help?</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Search these answers or send us a message.
          </p>
        </div>

        <div className="relative mb-6">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for answers… try 'cancel subscription' or 'connect Gmail'"
            className="pl-12 h-14 text-base rounded-xl"
            aria-label="Search help articles"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 -mx-1 px-1 scrollbar-thin">
          <button
            onClick={() => setActiveCat(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              activeCat === null
                ? "bg-foreground text-background border-foreground"
                : "border-border hover:bg-accent"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCat(activeCat === c ? null : c)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                activeCat === c
                  ? "bg-foreground text-background border-foreground"
                  : "border-border hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <section aria-label="FAQ results" className="space-y-2 mb-12">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Sparkles className="w-6 h-6 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-medium">No matches found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Try a different phrase{query && ` than "${query}"`}, or browse a category above.
              </p>
              {suggestions.length > 0 && (
                <div className="mt-5 text-left max-w-md mx-auto">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Related questions
                  </p>
                  <ul className="space-y-1.5">
                    {suggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => {
                            setQuery("");
                            setActiveCat(null);
                            setOpenId(s.id);
                            setTimeout(
                              () =>
                                document.getElementById(`faq-${s.id}`)?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                }),
                              30,
                            );
                          }}
                          className="text-sm text-left hover:underline"
                        >
                          {s.question}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-6">
                <Button
                  onClick={() =>
                    document.getElementById("support-form")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Contact support
                </Button>
              </div>
            </div>
          ) : (
            results.map((f) => {
              const isOpen = openId === f.id;
              return (
                <div
                  key={f.id}
                  id={`faq-${f.id}`}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  <button
                    onClick={() => setOpenId(isOpen ? null : f.id)}
                    className="w-full flex items-start gap-3 text-left px-4 py-3.5 hover:bg-accent/40 transition"
                    aria-expanded={isOpen}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                        <Highlight text={f.category} query={query} />
                      </div>
                      <div className="text-sm font-medium">
                        <Highlight text={f.question} query={query} />
                      </div>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 mt-1 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                      <Highlight text={f.answer} query={query} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <SupportForm />
      </main>
    </PublicShell>
  );
}

function SupportForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailValid && message.trim().length >= 5 && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      toast.error("Add a valid email and a message (at least 5 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithTimeout(
        "/api/public/help-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            topic,
            message,
            variant: "help",
            website,
            url: typeof window !== "undefined" ? window.location.href : "",
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          }),
        },
        20_000,
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
      setName("");
      setEmail("");
      setTopic("");
      setMessage("");
      toast.success("Message sent - we'll reply by email.");
    } catch (reason) {
      toast.error(
        reason instanceof DOMException && reason.name === "TimeoutError"
          ? "Support request timed out. Your message is still here—retry when connected."
          : "Network error. Your message is still here; please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="support-form" className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
          <Mail className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Still need help?</h2>
          <p className="text-sm text-muted-foreground">Send us a note and we'll reply by email.</p>
        </div>
      </div>

      {sent ? (
        <div className="rounded-xl border border-border bg-background/40 p-5 text-sm">
          <p className="font-medium">Thanks - your message is on its way.</p>
          <p className="text-muted-foreground mt-1">
            We'll reply to the email you provided. Feel free to close this page.
          </p>
          <Button variant="ghost" className="mt-3 h-8 px-3 text-xs" onClick={() => setSent(false)}>
            Send another message
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-name" className="text-xs font-medium">
                Your name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="s-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email" className="text-xs font-medium">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="s-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                aria-invalid={email.length > 0 && !emailValid}
              />
              {email.length > 0 && !emailValid && (
                <p className="text-[11px] text-destructive">Please enter a valid email.</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-topic" className="text-xs font-medium">
              Topic <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="s-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Billing, feedback, feature request…"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-message" className="text-xs font-medium">
              Message <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="s-message"
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              className="resize-none"
              placeholder="Tell us as much or as little as you'd like."
            />
            <p className="text-[11px] text-muted-foreground">{message.length}/4000</p>
          </div>
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            style={{
              position: "absolute",
              left: "-9999px",
              width: 1,
              height: 1,
            }}
            aria-hidden="true"
          />
          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-muted-foreground">
              Your email is used to respond to this request.
            </p>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send message
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
