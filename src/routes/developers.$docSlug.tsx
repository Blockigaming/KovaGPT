import { createFileRoute, notFound } from "@tanstack/react-router";
import { DEVELOPER_DOC_BY_SLUG } from "@/lib/developer-docs";
import { PublicPageView } from "@/components/public/PublicSite";
export const Route = createFileRoute("/developers/$docSlug")({
  loader: ({ params }) => {
    const item = DEVELOPER_DOC_BY_SLUG.get(params.docSlug);
    if (!item) throw notFound();
    return item;
  },
  head: ({ loaderData: item }) =>
    item
      ? {
          meta: [
            { title: `${item.title} | KovaGPT Developers` },
            { name: "description", content: item.description },
            {
              name: "robots",
              content: "noindex, follow",
            },
          ],
          links: [{ rel: "canonical", href: `https://kovagpt.com/developers/${item.slug}` }],
        }
      : {},
  component: Doc,
});
function Doc() {
  const item = Route.useLoaderData();
  return (
    <PublicPageView eyebrow="Developer documentation" title={item.title} summary={item.description}>
      <section className="rounded-2xl border bg-background p-6">
        <h2 className="text-xl font-semibold">Safe implementation baseline</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Use authenticated server routes, bounded inputs, explicit timeouts, stable errors, and
          least-privilege access. Availability is defined by the deployed KovaGPT capability
          registry.
        </p>
      </section>
      <section className="rounded-2xl border bg-background p-6">
        <h2 className="text-xl font-semibold">Production checklist</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Test cancellation, retries, quota exhaustion, billing settlement, and authorization loss
          before enabling production traffic.
        </p>
      </section>
    </PublicPageView>
  );
}
