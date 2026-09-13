import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicDetailPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";

export const Route = createFileRoute("/$section/$category/$articleSlug")({
  loader: async ({ params }) => {
    const key = `${params.section}/${params.category}/${params.articleSlug}`;
    const { PUBLIC_SOLUTION_PAGE_BY_KEY } = await import("@/lib/public-solution-content");
    const item = PUBLIC_SOLUTION_PAGE_BY_KEY.get(key);
    if (!item) throw notFound();
    return item;
  },
  head: ({ loaderData: item }) =>
    item
      ? {
          meta: [
            { title: `${item.title} | KovaGPT` },
            { name: "description", content: item.description },
            {
              name: "robots",
              content: isPublicIndexableRoute(`/${item.section}/${item.slug}`)
                ? "index, follow"
                : "noindex, follow",
            },
            { property: "og:title", content: item.title },
            { property: "og:description", content: item.description },
            { property: "og:type", content: "website" },
            { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
          ],
          links: [
            {
              rel: "canonical",
              href: `https://kovagpt.com/${item.section}/${item.slug}`,
            },
          ],
        }
      : {},
  component: SolutionDetail,
});

function SolutionDetail() {
  return <PublicDetailPageView item={Route.useLoaderData()} />;
}
