import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { requestKovas, type KovaCard } from "@/lib/custom-kovas-client";
import { PublicPageView } from "@/components/public/PublicSite";
export const Route = createFileRoute("/assistants")({
  component: AssistantsRoute,
  head: () => ({
    meta: [
      { title: "KovaGPT Assistants" },
      {
        name: "description",
        content: "Discover assistants published through KovaGPT's community directory.",
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
  const [cards, setCards] = useState<KovaCard[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void requestKovas<{ rows: KovaCard[] }>(
      null,
      `/api/kovas/directory${page ? `?after=${page}` : ""}`,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const rows = result.rows.slice(0, 20);
        setCards((old) => (page ? [...old, ...rows] : rows));
        setAfter(result.rows.length > 20 ? (rows.at(-1)?.id ?? null) : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("The directory is unavailable. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page]);
  const items = cards.filter((item) =>
    `${item.config.name} ${item.config.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <PublicPageView
      eyebrow="Directory"
      title="KovaGPT Assistants"
      summary="Explore conversational Kovas shared by their creators. Each Kova uses your account’s permissions and plan; creator accounts are never shared."
    >
      <div className="col-span-full">
        <label className="relative block">
          <span className="sr-only">Search loaded Kovas</span>
          <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-12 w-full rounded-xl border bg-background pl-12 pr-4"
            placeholder="Search loaded Kovas"
          />
        </label>
      </div>
      {items.length ? (
        items.map((item) => (
          <Link
            key={item.id}
            to={"/kovas" as never}
            search={{ id: item.id } as never}
            className="rounded-2xl border bg-background p-6"
          >
            <p className="text-xs text-muted-foreground">{item.config.icon}</p>
            <h2 className="mt-2 text-xl font-semibold">{item.config.name}</h2>
            <p className="mt-2 text-muted-foreground">{item.config.description}</p>
            <p className="mt-4 text-xs">Community publication · {item.config.mode}</p>
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
            Only currently public Kovas appear here.
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="col-span-full">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="col-span-full">
          Loading Kovas…
        </p>
      )}
      {after && (
        <button disabled={busy} className="col-span-full underline" onClick={() => setPage(after)}>
          Load more Kovas
        </button>
      )}
      <Link className="col-span-full underline" to={"/kovas" as never}>
        Create or manage your Kovas
      </Link>
    </PublicPageView>
  );
}
