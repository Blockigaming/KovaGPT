import { GuidedHelp } from "@/components/GuidedHelp";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, LifeBuoy, Mail, Plus, Search, X } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpSupportForm as SupportForm } from "@/components/HelpSupportForm";
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

function normalizeHelpSearch(value: string) {
  return value
    .toLowerCase()
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
    selected ? "border-foreground bg-foreground text-background" : "text-muted-foreground";
  return (
    <div
      aria-label="Help categories"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <Button
        variant="outline"
        className={buttonClass(active === null)}
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        All
      </Button>
      {visible.map((category) => (
        <Button
          variant="outline"
          key={category}
          className={buttonClass(active === category)}
          aria-pressed={active === category}
          onClick={() => onChange(active === category ? null : category)}
        >
          {category}
        </Button>
      ))}
      {!expanded && (
        <Button
          variant="outline"
          className={buttonClass(false)}
          onClick={onExpanded}
          aria-expanded={false}
        >
          More <Plus aria-hidden="true" />
        </Button>
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
      data-ui-reference="claude-help-article-row"
      className="overflow-hidden border-b border-border transition-colors"
    >
      <h3>
        <button
          data-kova-button-shape="preserve"
          type="button"
          id={`question-${faq.id}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-20 w-full items-start gap-4 px-5 py-4 text-left outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 sm:py-5"
        >
          <span className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-normal text-muted-foreground">
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
  const [visibleCount, setVisibleCount] = useState(24);
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
        data-ui-reference="claude-help-center"
        id="main-content"
        tabIndex={-1}
        className="kova-help-center mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10"
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
          <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
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
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(24);
              }}
              placeholder="Search help…"
              aria-label="Search help"
              className="h-12 rounded-xl border-border bg-muted pl-12 pr-14 text-base focus-visible:ring-2"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
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
        <GuidedHelp />
        <section aria-labelledby="answers-heading" aria-live="polite" className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="answers-heading" className="min-w-0 text-xl font-semibold">
              {query ? "Search results" : (activeCategory ?? "Browse answers")}
            </h2>
            <p className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
              {results.length} {results.length === 1 ? "answer" : "answers"}
            </p>
          </div>
          {results.length ? (
            <div className="space-y-3">
              {results.slice(0, visibleCount).map((faq) => (
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
            <div className="px-5 py-12 text-center">
              <Search className="mx-auto size-6 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold [overflow-wrap:anywhere]">
                No answers found for “{query}”
              </h3>
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
        {results.length > visibleCount ? (
          <Button
            type="button"
            variant="outline"
            className="mt-6 rounded-full"
            onClick={() => setVisibleCount((n) => n + 24)}
          >
            Show more answers
          </Button>
        ) : null}
        <SupportForm />
      </main>
    </PublicShell>
  );
}
