import { createFileRoute, notFound } from "@tanstack/react-router";
import { APP_CATEGORIES } from "@/content/directories";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";
export const Route = createFileRoute("/apps/$category")({
  beforeLoad: ({ params }) => {
    if (!(APP_CATEGORIES as readonly string[]).includes(params.category)) throw notFound();
  },
  head: ({ params }) => publicPageHead(page(params.category)),
  component: Category,
});
const page = (slug: string) => ({
  path: `/apps/${slug}`,
  title: `${slug.replaceAll("-", " ")} apps`,
  description: `KovaGPT app directory for ${slug.replaceAll("-", " ")}.`,
  family: "apps",
  eyebrow: "App directory",
  summary: "Browse supported connections and clearly labeled upcoming integrations.",
  sections: [
    {
      heading: "Connection truth",
      body: "KovaGPT only offers connection controls for integrations that are configured and supported. Upcoming entries do not display fake connection buttons.",
    },
  ],
  cta: { label: "View supported apps", href: "/apps" },
});
function Category() {
  return <PublicPageTemplate page={page(Route.useParams().category)} />;
}
