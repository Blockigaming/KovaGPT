import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { resolveAssistantState } from "@/lib/public-assistants";
import { PublicPageView } from "@/components/public/PublicSite";
export const Route = createFileRoute("/assistants/$assistantSlug")({
  loader: ({ params }) => {
    if (
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
        params.assistantSlug,
      )
    )
      throw redirect({ to: "/kovas" as never, search: { id: params.assistantSlug } as never });
    const result = resolveAssistantState(params.assistantSlug);
    if (result.state === "not_found") throw notFound();
    return result;
  },
  head: ({ loaderData }) =>
    loaderData?.state === "public"
      ? {
          meta: [
            { title: `${loaderData.item.name} | KovaGPT Assistants` },
            { name: "description", content: loaderData.item.description },
            { name: "robots", content: "index, follow" },
          ],
          links: [
            { rel: "canonical", href: `https://kovagpt.com/assistants/${loaderData.item.slug}` },
          ],
        }
      : {
          meta: [
            { title: "Assistant unavailable | KovaGPT" },
            { name: "robots", content: "noindex, nofollow" },
          ],
        },
  component: Detail,
});
function Detail() {
  const result = Route.useLoaderData();
  if (result.state === "removed")
    return (
      <PublicPageView
        eyebrow="Assistant"
        title="This assistant was removed"
        summary="It is no longer available in the public directory."
      >
        <section className="col-span-full rounded-2xl border bg-background p-6">
          <h2 className="font-semibold">Why am I seeing this?</h2>
          <p className="mt-2 text-muted-foreground">
            An owner or moderator can unpublish an assistant. Private assistant data is not
            revealed.
          </p>
        </section>
      </PublicPageView>
    );
  const item = result.item;
  return (
    <PublicPageView eyebrow={item.category} title={item.name} summary={item.description}>
      <section className="rounded-2xl border bg-background p-6">
        <h2 className="font-semibold">Creator</h2>
        <p className="mt-2 text-muted-foreground">
          {item.creator}
          {item.verified ? " · ownership verified" : ""}
        </p>
      </section>
      <section className="rounded-2xl border bg-background p-6">
        <h2 className="font-semibold">Safety and reporting</h2>
        <p className="mt-2 text-muted-foreground">
          Assistant tools remain subject to server authorization. Reporting requires a signed-in
          review flow.
        </p>
      </section>
    </PublicPageView>
  );
}
