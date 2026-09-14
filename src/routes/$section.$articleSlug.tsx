import { createFileRoute, notFound } from "@tanstack/react-router";
import { PUBLICATION_BY_KEY, publicationKey } from "@/lib/publications";
import { PublicDetailPageView, PublicPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";
export const Route = createFileRoute("/$section/$articleSlug")({
  loader: async ({ params }) => {
    const key = publicationKey(params.section, params.articleSlug);
    const publication = PUBLICATION_BY_KEY.get(key);
    if (publication) return { kind: "publication" as const, item: publication };
    if (params.section === "form") {
      const { PUBLIC_FORM_PAGE_BY_KEY } = await import("@/lib/public-form-content");
      const form = PUBLIC_FORM_PAGE_BY_KEY.get(key);
      if (form) return { kind: "detail" as const, item: form };
      throw notFound();
    }
    if (params.section === "global-affairs") {
      const { PUBLIC_GLOBAL_AFFAIRS_PAGE_BY_KEY } =
        await import("@/lib/public-global-affairs-content");
      const globalAffairs = PUBLIC_GLOBAL_AFFAIRS_PAGE_BY_KEY.get(key);
      if (globalAffairs) return { kind: "detail" as const, item: globalAffairs };
      throw notFound();
    }
    if (params.section === "academy") {
      const { PUBLIC_ACADEMY_PAGE_BY_KEY } = await import("@/lib/public-academy-content");
      const academy = PUBLIC_ACADEMY_PAGE_BY_KEY.get(key);
      if (academy) return { kind: "detail" as const, item: academy };
      throw notFound();
    }
    if (params.section === "policies") {
      const { PUBLIC_POLICY_PAGE_BY_KEY } = await import("@/lib/public-policy-content");
      const policy = PUBLIC_POLICY_PAGE_BY_KEY.get(key);
      if (policy) return { kind: "detail" as const, item: policy };
      throw notFound();
    }
    const { PUBLIC_DETAIL_PAGE_BY_KEY } = await import("@/lib/public-detail-content");
    const detail = PUBLIC_DETAIL_PAGE_BY_KEY.get(key);
    if (detail) return { kind: "detail" as const, item: detail };
    if (params.section === "business") {
      if (params.articleSlug === "plugins" || params.articleSlug === "partners") {
        const { PUBLIC_ECOSYSTEM_PAGE_BY_KEY } = await import("@/lib/public-ecosystem-content");
        const ecosystem = PUBLIC_ECOSYSTEM_PAGE_BY_KEY.get(key);
        if (ecosystem) return { kind: "detail" as const, item: ecosystem };
      }
      const { PUBLIC_BUSINESS_PAGE_BY_KEY } = await import("@/lib/public-business-content");
      const business = PUBLIC_BUSINESS_PAGE_BY_KEY.get(key);
      if (business) return { kind: "detail" as const, item: business };
    }
    throw notFound();
  },
  head: ({ loaderData: data }) =>
    data
      ? {
          meta: [
            { title: `${data.item.title} | KovaGPT` },
            { name: "description", content: data.item.description },
            {
              name: "robots",
              content: isPublicIndexableRoute(`/${data.item.section}/${data.item.slug}`)
                ? "index, follow"
                : "noindex, follow",
            },
            { property: "og:title", content: data.item.title },
            { property: "og:description", content: data.item.description },
            { property: "og:type", content: data.kind === "publication" ? "article" : "website" },
            { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
          ],
          links: [
            {
              rel: "canonical",
              href: `https://kovagpt.com/${data.item.section}/${data.item.slug}`,
            },
          ],
        }
      : {},
  component: Article,
});
function Article() {
  const data = Route.useLoaderData();
  if (data.kind === "detail") return <PublicDetailPageView item={data.item} />;
  const item = data.item;
  return (
    <PublicPageView
      eyebrow={`${item.section.replaceAll("-", " ")} · ${item.publishedAt}`}
      title={item.title}
      summary={item.description}
    >
      {item.body.map((body, index) => (
        <section key={body} className="rounded-2xl border bg-background p-6">
          <h2 className="font-semibold">{index ? "What this means" : "Overview"}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{body}</p>
        </section>
      ))}
    </PublicPageView>
  );
}
