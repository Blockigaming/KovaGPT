import { createFileRoute, notFound } from "@tanstack/react-router";
import { PUBLICATION_BY_KEY, publicationKey } from "@/lib/publications";
import { PublicDetailPageView, PublicPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";
export const Route = createFileRoute("/$section/$articleSlug")({
  loader: async ({ params }) => {
    const key = publicationKey(params.section, params.articleSlug);
    const { PUBLIC_DETAIL_PAGE_BY_KEY } = await import("@/lib/public-detail-content");
    const detail = PUBLIC_DETAIL_PAGE_BY_KEY.get(key);
    if (detail) return { kind: "detail" as const, item: detail };
    const publication = PUBLICATION_BY_KEY.get(key);
    if (publication) return { kind: "publication" as const, item: publication };
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
