import { createFileRoute, notFound } from "@tanstack/react-router";
import { PUBLICATION_BY_KEY, publicationKey } from "@/lib/publications";
import { PublicPageView } from "@/components/public/PublicSite";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";
export const Route = createFileRoute("/$section/$articleSlug")({
  loader: ({ params }) => {
    const item = PUBLICATION_BY_KEY.get(publicationKey(params.section, params.articleSlug));
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
          ],
          links: [{ rel: "canonical", href: `https://kovagpt.com/${item.section}/${item.slug}` }],
        }
      : {},
  component: Article,
});
function Article() {
  const item = Route.useLoaderData();
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
