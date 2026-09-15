import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  LifeBuoy,
  Loader2,
  Mail,
  Search,
  X,
} from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { HELP_CATEGORIES, HELP_FAQS, type HelpFaq } from "@/lib/help-center-data";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help Center | KovaGPT" },
      {
        name: "description",
        content:
          "Search KovaGPT help for answers about chat, plans, projects, apps, privacy, billing, and troubleshooting.",
      },
      { property: "og:title", content: "Help Center | KovaGPT" },
      { property: "og:description", content: "Search answers or contact KovaGPT Support." },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/help" }],
  }),
  component: HelpPage,
});

const PRIMARY_CATEGORIES = HELP_CATEGORIES.slice(0, 8);
const TOPICS = [
  "Account & sign-in",
  "Billing & subscription",
  "Chat or responses",
  "Projects",
  "Apps & integrations",
  "Images",
  "Bug report",
  "Feature request",
  "Privacy & security",
  "Other",
];

function normalizeHelpSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(cannot|cant)\b/g, "can not")
    .replace(/\b(login|log-in)\b/g, "sign in")
    .replace(/\bgoogle mail\b/g, "gmail")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreHelpFaq(faq: HelpFaq, rawQuery: string): number {
  const query = normalizeHelpSearch(rawQuery);
  if (!query) return 0;
  const title = normalizeHelpSearch(faq.question);
  const category = normalizeHelpSearch(faq.category);
  const keywords = normalizeHelpSearch(faq.keywords.join(" "));
  const answer = normalizeHelpSearch(faq.answer);
  const terms = query.split(" ").filter(Boolean);
  let score = title === query ? 500 : title.includes(query) ? 180 : 0;
  if (category === query) score += 120;
  if (keywords.includes(query)) score += 100;
  if (answer.includes(query)) score += 45;
  for (const term of terms) {
    if (title.includes(term)) score += 24;
    if (keywords.includes(term)) score += 16;
    if (category.includes(term)) score += 12;
    if (answer.includes(term)) score += 5;
  }
  return terms.every((term) => `${title} ${category} ${keywords} ${answer}`.includes(term))
    ? score
    : 0;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = Array.from(
    new Set(
      normalizeHelpSearch(query)
        .split(" ")
        .filter((term) => term.length > 1),
    ),
  );
  if (!terms.length) return <>{text}</>;
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(expression).map((part, index) =>
        terms.includes(normalizeHelpSearch(part)) ? (
          <mark key={index} className="rounded-sm bg-primary/10 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function CategoryFilters({
  active,
  expanded,
  onChange,
  onExpanded,
}: {
  active: string | null;
  expanded: boolean;
  onChange: (category: string | null) => void;
  onExpanded: () => void;
}) {
  const visible = expanded ? HELP_CATEGORIES : PRIMARY_CATEGORIES;
  const buttonClass = (selected: boolean) =>
    `h-11 shrink-0 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`;
  return (
    <div
      aria-label="Help categories"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <button
        className={buttonClass(active === null)}
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {visible.map((category) => (
        <button
          key={category}
          className={buttonClass(active === category)}
          aria-pressed={active === category}
          onClick={() => onChange(active === category ? null : category)}
        >
          {category}
        </button>
      ))}
      {!expanded && (
        <button className={buttonClass(false)} onClick={onExpanded} aria-expanded={false}>
          More <span aria-hidden="true">+</span>
        </button>
      )}
    </div>
  );
}

function FaqRow({
  faq,
  open,
  query,
  onToggle,
}: {
  faq: HelpFaq;
  open: boolean;
  query: string;
  onToggle: () => void;
}) {
  const panelId = `answer-${faq.id}`;
  return (
    <article
      id={`faq-${faq.id}`}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card transition-colors hover:border-border"
    >
      <h3>
        <button
          type="button"
          id={`question-${faq.id}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-20 w-full items-start gap-4 px-5 py-4 text-left outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 sm:py-5"
        >
          <span className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Highlight text={faq.category} query={query} />
            </span>
            <span className="block text-[15px] font-medium leading-6 text-foreground sm:text-base">
              <Highlight text={faq.question} query={query} />
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-3 size-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={`question-${faq.id}`}
        hidden={!open}
        className="px-5 pb-5 text-[15px] leading-7 text-muted-foreground sm:px-6 sm:pb-6"
      >
        <Highlight text={faq.answer} query={query} />
      </div>
    </article>
  );
}

function HelpPage() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const results = useMemo(() => {
    const filtered = activeCategory
      ? HELP_FAQS.filter((faq) => faq.category === activeCategory)
      : HELP_FAQS;
    if (!query.trim()) return filtered;
    return filtered
      .map((faq) => ({ faq, score: scoreHelpFaq(faq, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ faq }) => faq);
  }, [activeCategory, query]);
  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10"
      >
        <div className="mb-7 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" /> Back
          </Link>
          <a
            href="mailto:support@kovagpt.com"
            className="hidden min-h-11 items-center gap-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
          >
            <Mail className="size-4" /> support@kovagpt.com
          </a>
        </div>
        <header className="mx-auto mb-9 max-w-3xl text-center sm:mb-11">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <LifeBuoy className="size-4 text-primary" /> KovaGPT Help Center
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">How can we help?</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Search answers, browse common topics, or contact KovaGPT Support.
          </p>
          <div className="relative mt-7 text-left">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help…"
              aria-label="Search help"
              className="h-14 rounded-2xl border-border bg-card pl-12 pr-12 text-base shadow-sm focus-visible:ring-2"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-left text-xs text-muted-foreground">
            Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.
          </p>
        </header>
        <CategoryFilters
          active={activeCategory}
          expanded={showAllCategories}
          onChange={setActiveCategory}
          onExpanded={() => setShowAllCategories(true)}
        />
        <section aria-labelledby="answers-heading" aria-live="polite" className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="answers-heading" className="text-xl font-semibold">
              {query ? "Search results" : (activeCategory ?? "Browse answers")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {results.length} {results.length === 1 ? "answer" : "answers"}
            </p>
          </div>
          {results.length ? (
            <div className="space-y-3">
              {results.map((faq) => (
                <FaqRow
                  key={faq.id}
                  faq={faq}
                  query={query}
                  open={openIds.has(faq.id)}
                  onToggle={() => toggle(faq.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center">
              <Search className="mx-auto size-6 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No answers found for “{query}”</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Try a different search or send us a message below.
              </p>
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => {
                  setQuery("");
                  setActiveCategory(null);
                }}
              >
                Clear search
              </Button>
            </div>
          )}
        </section>
        <SupportForm />
      </main>
    </PublicShell>
  );
}

function SupportForm() {
  const { user } = useUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const initializedUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const userId = user?.id ?? null;
    if (initializedUserId.current === userId) return;
    initializedUserId.current = userId;
    setName(user?.fullName ?? user?.firstName ?? "");
    setEmail(user?.primaryEmailAddress?.emailAddress ?? "");
  }, [user]);
  const cleanEmail = email.trim();
  const emailError = !cleanEmail
    ? "Enter your email address."
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
      ? "Enter a valid email address."
      : "";
  const messageError = !message.trim()
    ? "Write a message before sending."
    : message.length > 4000
      ? "Messages can be up to 4,000 characters."
      : "";
  const invalid = Boolean(emailError || messageError);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setStatus("idle");
    if (invalid) return;
    setStatus("sending");
    try {
      const response = await fetchWithTimeout(
        "/api/public/help-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email: cleanEmail,
            topic,
            message: message.trim(),
            variant: "help",
            website,
            url: window.location.href,
            userAgent: navigator.userAgent,
          }),
        },
        20_000,
      );
      if (!response.ok) throw new Error("request_failed");
      setSubmittedEmail(cleanEmail);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };
  if (status === "sent")
    return (
      <section id="support-form" className="mt-20 border-t border-border pt-12 sm:mt-24 sm:pt-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 text-center sm:p-10">
          <CheckCircle2 className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-2xl font-semibold">Message sent</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Thanks - your request has been sent to KovaGPT Support. We’ll reply at {submittedEmail}.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => {
              setStatus("idle");
              setMessage("");
              setTopic("");
              setTouched(false);
            }}
          >
            Send another message
          </Button>
        </div>
      </section>
    );
  return (
    <section
      id="support-form"
      className="mt-20 border-t border-border pt-12 sm:mt-24 sm:pt-16"
      aria-labelledby="support-heading"
    >
      <div className="mb-7 text-center">
        <h2 id="support-heading" className="text-2xl font-semibold sm:text-3xl">
          Still need help?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll
          reply by email.
        </p>
      </div>
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/70 p-5 sm:p-8">
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <Label htmlFor="support-name">Name</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Input
                id="support-name"
                autoComplete="name"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12"
              />
            </div>
            <div>
              <Label htmlFor="support-email">
                Email{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                id="support-email"
                className="mt-2 h-12"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onBlur={() => setTouched(true)}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={touched && Boolean(emailError)}
                aria-describedby={touched && emailError ? "support-email-error" : undefined}
              />
              {touched && emailError && (
                <p
                  id="support-email-error"
                  role="alert"
                  className="mt-1.5 text-sm text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <Label htmlFor="support-topic">Topic</Label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <select
              id="support-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="flex h-12 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose a topic</option>
              {TOPICS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="support-message">
              Message{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </Label>
            <Textarea
              id="support-message"
              className="mt-2 min-h-40 resize-y"
              maxLength={4000}
              value={message}
              onBlur={() => setTouched(true)}
              onChange={(e) => setMessage(e.target.value)}
              required
              aria-invalid={touched && Boolean(messageError)}
              aria-describedby={`support-message-count${touched && messageError ? " support-message-error" : ""}`}
              placeholder="Tell us what happened, what you expected, and any error message you saw."
            />
            {touched && messageError && (
              <p
                id="support-message-error"
                role="alert"
                className="mt-1.5 text-sm text-destructive"
              >
                {messageError}
              </p>
            )}
            <p
              id="support-message-count"
              className={`mt-2 text-right text-xs ${message.length >= 3600 ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {message.length.toLocaleString()} / 4,000
            </p>
          </div>
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="absolute -left-[9999px] size-px"
            aria-hidden="true"
          />
          {status === "error" && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              We couldn’t send your message. Please check your connection and try again. Your
              message is still here.
            </div>
          )}
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              We’ll use your email only to respond to this support request.
            </p>
            <Button
              type="submit"
              className="h-12 w-full px-6 sm:w-auto"
              disabled={status === "sending"}
            >
              {status === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Sending…
                </>
              ) : (
                "Send message"
              )}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
