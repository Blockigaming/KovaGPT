import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { publicShareSnapshot, type PublicChatSnapshot } from "@/lib/public-chat-share-policy.mjs";
export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared conversation · KovaGPT" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: SharedChatPage,
});
function SharedChatPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<PublicChatSnapshot | null>(null),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void fetch(`/api/chat-share/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "This shared chat is unavailable.");
        return publicShareSnapshot({ title: body.title, messages: body.snapshot?.messages });
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Try again.");
      });
    return () => controller.abort();
  }, [token, retry]);
  return (
    <main className="kova-public-share">
      <header>
        <Link to="/">
          <NovaLogo decorative />
          KovaGPT
        </Link>
        <Link to="/">
          Open KovaGPT
          <ArrowRight aria-hidden />
        </Link>
      </header>
      {error ? (
        <section role="alert">
          <h1>Shared chat unavailable</h1>
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : !data ? (
        <section role="status">
          <Loader2 aria-hidden className="animate-spin" />
          Loading shared conversation…
        </section>
      ) : (
        <section>
          <p className="kova-share-eyebrow">Shared conversation · Read only</p>
          <h1>{data.title}</h1>
          <p className="kova-share-note">
            A text snapshot shared by its author. KovaGPT can make mistakes.
          </p>
          {data.snapshot.messages.map((m, i) => (
            <article key={i} data-role={m.role}>
              <strong>{m.role === "user" ? "You" : "KovaGPT"}</strong>
              <p>{m.content}</p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
