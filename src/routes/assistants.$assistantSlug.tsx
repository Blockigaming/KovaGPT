import { createFileRoute, notFound } from "@tanstack/react-router";
import { ASSISTANTS } from "@/content/directories";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";
const get = (slug: string) => ASSISTANTS.find((a) => a.slug === slug);
const page = (slug: string) => {
  const a = get(slug)!;
  return {
    path: `/assistants/${slug}`,
    title: a.name,
    description: `Use the KovaGPT ${a.name.toLowerCase()} for a focused, reviewable workflow.`,
    family: "assistants",
    eyebrow: "Assistant",
    summary: a.summary,
    sections: [
      {
        heading: "How to begin",
        body: "Describe the result you need, relevant constraints, and how you will verify it.",
      },
    ],
    cta: { label: "Open KovaGPT", href: "/" },
  };
};
export const Route = createFileRoute("/assistants/$assistantSlug")({
  beforeLoad: ({ params }) => {
    if (!get(params.assistantSlug)) throw notFound();
  },
  head: ({ params }) => publicPageHead(page(params.assistantSlug)),
  component: AssistantPage,
});

function AssistantPage() {
  return <PublicPageTemplate page={page(Route.useParams().assistantSlug)} />;
}
