import { useId } from "react";

export type PublicFaqItem = Readonly<{ q: string; a: string }>;

/** Shared native disclosure: content stays readable without client JavaScript. */
export function PublicFaq({
  items,
  title = "Frequently asked questions",
}: {
  items: readonly PublicFaqItem[];
  title?: string;
}) {
  const headingId = useId();
  if (!items.length) return null;
  return (
    <section aria-labelledby={headingId} className="min-w-0 [overflow-wrap:anywhere]">
      <h2 id={headingId} className="mb-4 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {items.map((item) => (
          <details key={item.q} className="group min-w-0 px-4 py-3 sm:px-6">
            <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-sm py-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">{item.q}</span>
              <span
                aria-hidden="true"
                className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
              >
                +
              </span>
            </summary>
            <p className="mb-2 mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
