import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { getSharedWithMe, type SharedChatInbox } from "@/lib/shared-chats.functions";

export const Route = createFileRoute("/share/$shareId")({
  component: SharedChatPage,
  head: () => ({
    meta: [{ title: "Shared chat · KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});

function SharedChatPage() {
  const { shareId } = Route.useParams();
  const { isLoaded, isSignedIn, user } = useUser();
  const ownerId = user?.id ?? null;
  const key = JSON.stringify([ownerId, shareId]);
  const [result, setResult] = useState<{
    key: string;
    share: SharedChatInbox | null;
    error?: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!isLoaded || !isSignedIn || !ownerId) return;
    let current = true;
    void getSharedWithMe({ data: { id: shareId } })
      .then((share) => {
        if (current) setResult({ key, share });
      })
      .catch(() => {
        if (current) setResult({ key, share: null, error: true });
      });
    return () => {
      current = false;
    };
  }, [isLoaded, isSignedIn, ownerId, key, retry, shareId]);
  const visible = result?.key === key ? result : null;
  return (
    <AppShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
        <Link
          to="/library"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground"
        >
          ← Back to Library
        </Link>
        {!isLoaded ? (
          <p role="status" className="mt-8">
            Loading account…
          </p>
        ) : !isSignedIn || !ownerId ? (
          <section className="mt-8 space-y-4">
            <h1 className="text-2xl font-semibold">Sign in to view this chat</h1>
            <p className="text-sm text-muted-foreground">
              Only the intended recipient can open this shared snapshot.
            </p>
            <SignInButton mode="modal">
              <button
                type="button"
                className="min-h-11 rounded-xl bg-foreground px-4 text-background"
              >
                Sign in
              </button>
            </SignInButton>
          </section>
        ) : !visible ? (
          <p role="status" className="mt-8">
            Loading shared chat…
          </p>
        ) : visible.error ? (
          <section className="mt-8 space-y-4">
            <h1 className="text-2xl font-semibold">This shared chat couldn't load</h1>
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="min-h-11 rounded-xl border px-4"
            >
              Retry
            </button>
          </section>
        ) : !visible.share ? (
          <section className="mt-8 space-y-3">
            <h1 className="text-2xl font-semibold">Shared chat unavailable</h1>
            <p className="text-sm text-muted-foreground">
              This link may have been revoked, or this account may not have access.
            </p>
          </section>
        ) : (
          <article className="mt-8">
            <header className="border-b border-border pb-5">
              <p className="text-xs font-medium text-muted-foreground">Read-only shared snapshot</p>
              <h1 className="mt-2 break-words text-2xl font-semibold">{visible.share.title}</h1>
              <p className="mt-2 text-xs text-muted-foreground">
                {visible.share.snapshot.messages.length} messages · Shared{" "}
                {new Date(visible.share.created_at).toLocaleDateString()}
              </p>
            </header>
            <ol className="divide-y divide-border">
              {visible.share.snapshot.messages.map((message, index) => (
                <li key={index} className="py-6">
                  <p className="mb-2 text-xs font-semibold capitalize text-muted-foreground">
                    {message.role}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {message.content}
                  </p>
                </li>
              ))}
            </ol>
          </article>
        )}
      </main>
    </AppShell>
  );
}
