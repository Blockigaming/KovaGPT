import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { PublicPageView } from "@/components/public/PublicSite";
import { PUBLIC_ACADEMY_PAGES } from "@/lib/public-academy-content";

const academy = {
  title: "KovaGPT Academy",
  eyebrow: "Learning hub",
  description:
    "Build practical AI skills with original KovaGPT guidance and responsible-use boundaries.",
  summary:
    "Start with the product basics, practice on low-risk work, and learn how to verify output before using AI in consequential workflows.",
  sections: [
    {
      title: "Learn by doing",
      body: "Begin with a clear task, provide only necessary context, compare the result with your source material, and revise with specific feedback.",
    },
    {
      title: "Use judgment",
      body: "Treat generated content as a draft. Sensitive, regulated, financial, legal, medical, and safety-critical decisions need qualified review.",
    },
    {
      title: "Respect data boundaries",
      body: "Do not upload secrets or personal information that the task does not require. Follow your organization's approved tools and retention rules.",
    },
  ],
} as const;

export const Route = createFileRoute("/academy")({
  head: () => ({
    meta: [
      { title: `${academy.title} | KovaGPT` },
      { name: "description", content: academy.description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: `${academy.title} | KovaGPT` },
      { property: "og:description", content: academy.description },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/writer.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/academy" }],
  }),
  component: AcademyPage,
});

function AcademyPage() {
  return (
    <PublicPageView
      eyebrow={academy.eyebrow}
      title={academy.title}
      summary={academy.summary}
      primaryAction={{ label: "Start Academy guides", to: "/academy/ai-fundamentals" }}
    >
      {academy.sections.map((section) => (
        <article key={section.title} className="rounded-2xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
        </article>
      ))}
      {PUBLIC_ACADEMY_PAGES.map((page) => (
        <Link
          key={page.slug}
          to={`/academy/${page.slug}` as never}
          className="group rounded-2xl border border-border bg-background p-6 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">{page.title}</h2>
            <ArrowRight
              className="mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 leading-7 text-muted-foreground">{page.summary}</p>
        </Link>
      ))}
    </PublicPageView>
  );
}
