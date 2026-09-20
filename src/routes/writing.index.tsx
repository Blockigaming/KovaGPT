import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FilePenLine } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WRITING_TOOLS } from "@/lib/writing-tool-catalog";

export const Route = createFileRoute("/writing/")({
  component: WritingIndex,
  head: () => ({
    meta: [
      { title: "Writing tools | KovaGPT" },
      {
        name: "description",
        content: "Explore Kova writing, rewriting, checking, citation, and counting tools.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function WritingIndex() {
  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-full bg-background px-4 pb-16 pt-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto w-full max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-background shadow-sm">
              <FilePenLine aria-hidden="true" className="h-6 w-6" strokeWidth={1.7} />
            </div>
            <h1 className="mt-5 text-[32px] font-semibold tracking-[-0.03em] sm:text-4xl">
              Kova writing tools
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Draft, revise, check, summarize, and count text in focused workspaces built around the
              same familiar Kova interface.
            </p>
          </div>

          <section
            aria-label="Writing tools"
            className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {WRITING_TOOLS.map((tool) => (
              <Link
                key={tool.slug}
                to="/writing/$toolSlug"
                params={{ toolSlug: tool.slug }}
                className="group flex min-h-36 flex-col rounded-2xl border border-border bg-background p-5 transition-colors hover:bg-muted/70"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-semibold tracking-[-0.01em]">{tool.title}</h2>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {tool.shortDescription}
                </p>
              </Link>
            ))}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
