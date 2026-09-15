import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicDetailPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";

export const Route = createFileRoute("/$section/$category/$subcategory/$articleSlug")({
  loader: async ({ params }) => {
    if (params.section !== "business") throw notFound();
    const key = `${params.section}/${params.category}/${params.subcategory}/${params.articleSlug}`;
    const { PUBLIC_BUSINESS_PAGE_BY_KEY } = await import("@/lib/public-business-content");
    const business = PUBLIC_BUSINESS_PAGE_BY_KEY.get(key);
    if (!business) throw notFound();
    return business;
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
            { property: "og:title", content: `${item.title} | KovaGPT` },
            { property: "og:description", content: item.description },
            { property: "og:type", content: "website" },
          ],
          links: [
            {
              rel: "canonical",
              href: `https://kovagpt.com/${item.section}/${item.slug}`,
            },
          ],
        }
      : {},
  component: BusinessResourcePage,
});

function BusinessResourcePage() {
  const item = Route.useLoaderData();
  return <PublicDetailPageView item={item} />;
}
