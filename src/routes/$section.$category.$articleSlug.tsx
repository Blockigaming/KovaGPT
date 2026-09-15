import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicDetailPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";

export const Route = createFileRoute("/$section/$category/$articleSlug")({
  loader: async ({ params }) => {
    const key = `${params.section}/${params.category}/${params.articleSlug}`;
    if (params.section === "form") {
      const { PUBLIC_FORM_PAGE_BY_KEY } = await import("@/lib/public-form-content");
      const form = PUBLIC_FORM_PAGE_BY_KEY.get(key);
      if (!form) throw notFound();
      return form;
    }
    if (params.section === "policies") {
      const { PUBLIC_POLICY_PAGE_BY_KEY } = await import("@/lib/public-policy-content");
      const policy = PUBLIC_POLICY_PAGE_BY_KEY.get(key);
      if (!policy) throw notFound();
      return policy;
    }
    if (params.section === "academy") {
      const { PUBLIC_ACADEMY_PAGE_BY_KEY } = await import("@/lib/public-academy-content");
      const academy = PUBLIC_ACADEMY_PAGE_BY_KEY.get(key);
      if (!academy) throw notFound();
      return academy;
    }
    if (params.section === "business") {
      if (params.category === "plugins" || params.category === "partners") {
        const { PUBLIC_ECOSYSTEM_PAGE_BY_KEY } = await import("@/lib/public-ecosystem-content");
        const ecosystem = PUBLIC_ECOSYSTEM_PAGE_BY_KEY.get(key);
        if (!ecosystem) throw notFound();
        return ecosystem;
      }
      const { PUBLIC_BUSINESS_PAGE_BY_KEY } = await import("@/lib/public-business-content");
      const business = PUBLIC_BUSINESS_PAGE_BY_KEY.get(key);
      if (!business) throw notFound();
      return business;
    }
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
