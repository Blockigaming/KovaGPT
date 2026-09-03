import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { PUBLIC_PAGE_BY_SLUG } from "@/lib/public-content";
import { PUBLICATIONS, PUBLICATION_SECTIONS } from "@/lib/publications";
import { PublicPageView } from "@/components/public/PublicSite";
import { isReservedPublicPath } from "@/lib/public-route-policy.mjs";

const label = (value: string) =>
  value
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => {
    if (isReservedPublicPath(`/${params.slug}`)) throw notFound();
    const item = PUBLIC_PAGE_BY_SLUG.get(params.slug);
    if (item?.review) throw notFound();
    if (item) return { kind: "page" as const, item };
    if ((PUBLICATION_SECTIONS as readonly string[]).includes(params.slug))
      return {
        kind: "index" as const,
        section: params.slug,
        items: PUBLICATIONS.filter((item) => item.section === params.slug),
      };
    throw notFound();
  },
  head: ({ loaderData: data }) => {
    if (!data) return {};
    if (data.kind === "page")
      return {
        meta: [
          { title: `${data.item.title} | KovaGPT` },
          { name: "description", content: data.item.description },
          { name: "robots", content: "noindex, follow" },
          { property: "og:title", content: `${data.item.title} | KovaGPT` },
          { property: "og:description", content: data.item.description },
          { property: "og:type", content: "website" },
          { property: "og:image", content: "https://kovagpt.com/og/writer.jpg" },
        ],
        links: [{ rel: "canonical", href: `https://kovagpt.com/${data.item.slug}` }],
      };
    return {
      meta: [
        { title: `${label(data.section)} | KovaGPT` },
        {
          name: "description",
          content: `Original KovaGPT ${label(data.section).toLowerCase()} and updates.`,
        },
        { name: "robots", content: "noindex, follow" },
      ],
      links: [{ rel: "canonical", href: `https://kovagpt.com/${data.section}` }],
    };
  },
  component: Page,
});
function Page() {
  const data = Route.useLoaderData();
  if (data.kind === "index")
    return (
      <PublicPageView
        eyebrow="Publishing"
        title={label(data.section)}
        summary={`Original KovaGPT ${label(data.section).toLowerCase()}, maintained as structured content.`}
      >
        {data.items.length ? (
          data.items.map((item) => (
            <Link
              key={item.slug}
              to={`/${item.section}/${item.slug}` as never}
              className="rounded-2xl border bg-background p-6 hover:bg-muted"
            >
              <p className="text-xs text-muted-foreground">{item.publishedAt}</p>
              <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
              <p className="mt-3 text-muted-foreground">{item.description}</p>
            </Link>
          ))
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed p-8 text-center">
            <h2 className="font-semibold">No published entries yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Drafts and unapproved content are not public.
            </p>
          </div>
        )}
      </PublicPageView>
    );
  const item = data.item;
  return (
    <PublicPageView
      eyebrow={item.eyebrow}
      title={item.title}
      summary={item.summary}
      review={item.review}
    >
      {item.sections.map((section) => (
        <article key={section.title} className="rounded-2xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
        </article>
      ))}
    </PublicPageView>
  );
}
