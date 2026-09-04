import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PUBLIC_ASSISTANTS } from "@/lib/public-assistants";
import { PublicPageView } from "@/components/public/PublicSite";
export const Route = createFileRoute("/assistants")({
  component: AssistantsRoute,
  head: () => ({
    meta: [
      { title: "KovaGPT Assistants" },
      {
        name: "description",
        content: "Discover assistants published through KovaGPT's reviewed directory.",
      },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/assistants" }],
  }),
});

function AssistantsRoute() {
  const assistantMatch = useMatch({
    from: "/assistants/$assistantSlug",
    shouldThrow: false,
  });

  return assistantMatch ? <Outlet /> : <DirectoryPage />;
}

function DirectoryPage() {
  const [query, setQuery] = useState("");
  const items = useMemo(
    () =>
      PUBLIC_ASSISTANTS.filter((item) =>
        `${item.name} ${item.description} ${item.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query],
  );
  return (
    <PublicPageView
      eyebrow="Directory"
      title="KovaGPT Assistants"
      summary="Discover assistants published by verified KovaGPT creators. This directory never imports public GPT listings from another service."
    >
      <div className="col-span-full">
        <label className="relative block">
          <span className="sr-only">Search assistants</span>
          <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-12 w-full rounded-xl border bg-background pl-12 pr-4"
            placeholder="Search assistants"
          />
        </label>
      </div>
      {items.length ? (
        items.map((item) => (
          <Link
            key={item.slug}
            to="/assistants/$assistantSlug"
            params={{ assistantSlug: item.slug }}
            className="rounded-2xl border bg-background p-6"
          >
            <p className="text-xs text-muted-foreground">{item.category}</p>
            <h2 className="mt-2 text-xl font-semibold">{item.name}</h2>
            <p className="mt-2 text-muted-foreground">{item.description}</p>
            <p className="mt-4 text-xs">
              By {item.creator}
              {item.verified ? " · Verified" : ""}
            </p>
          </Link>
        ))
      ) : (
        <section
          className="col-span-full rounded-2xl border border-dashed bg-background p-10 text-center"
          role="status"
        >
          <h2 className="font-semibold">
            {query ? "No matching assistants" : "No assistants published yet"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only reviewed, public assistants appear here.
          </p>
        </section>
      )}
    </PublicPageView>
  );
}
