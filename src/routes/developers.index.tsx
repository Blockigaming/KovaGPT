import { createFileRoute } from "@tanstack/react-router";
import { PublicPageView } from "@/components/public/PublicSite";
import { PUBLIC_PAGE_BY_SLUG } from "@/lib/public-content";

const page = PUBLIC_PAGE_BY_SLUG.get("developers")!;

export const Route = createFileRoute("/developers/")({
  component: DevelopersOverview,
  head: () => ({
    meta: [
      { title: `${page.title} | KovaGPT` },
      { name: "description", content: page.description },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/developers" }],
  }),
});

function DevelopersOverview() {
  return (
    <PublicPageView eyebrow={page.eyebrow} title={page.title} summary={page.summary}>
      {page.sections.map((section) => (
        <article key={section.title} className="rounded-2xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
        </article>
      ))}
    </PublicPageView>
  );
}
