import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, RefreshCw, Trash2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { NovaLogo } from "@/components/NovaLogo";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
  head: () => ({
    meta: [
      { title: "Library | KovaGPT" },
      { name: "description", content: "Your saved chats, files, and generated images in KovaGPT." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type LibItem = import("@/lib/library.functions").LibraryItem;

import { loadGuestLibrary, deleteGuestItem } from "@/lib/guest-library";


function LibraryPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const load = async () => {
    if (!isSignedIn) {
      setItems(loadGuestItems());
      return;
    }
    setLoading(true);
    try {
      const { listMyLibrary } = await import("@/lib/library.functions");
      setItems(await listMyLibrary());
    } catch (e) {
      console.error(e);
      toast.error("Could not load your library.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    load();
  }, [isLoaded, isSignedIn]);

  const remove = async (id: string) => {
    if (!isSignedIn) {
      const next = items.filter((i) => i.id !== id);
      setItems(next);
      sessionStorage.setItem(GUEST_KEY, JSON.stringify(next));
      return;
    }
    try {
      const { deleteLibraryItem } = await import("@/lib/library.functions");
      await deleteLibraryItem({ data: { id } });
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const filtered = items.filter((it) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return it.title.toLowerCase().includes(q) || (it.content_text ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="p-2 rounded-md hover:bg-accent transition" aria-label="Back to chat">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="inline-flex rounded-full dark:bg-black dark:p-[2px]">
            <NovaLogo className="w-6 h-6" />
          </span>
          <h1 className="font-display font-semibold tracking-tight text-base flex items-center gap-2">
            <FolderOpen className="w-4 h-4" /> Library
          </h1>
          <div className="ml-auto">
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {!isSignedIn && isLoaded && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div className="font-medium mb-1">You are browsing as a guest.</div>
            <p className="text-muted-foreground text-xs mb-3">
              Items saved while signed out stay only in this browser tab and will be cleared if you
              refresh or close it. Sign in to keep your library across devices.
            </p>
            <SignInButton mode="modal">
              <button className="px-3 py-1.5 rounded-full bg-foreground text-background text-xs font-medium hover:opacity-90 transition">
                Sign in to save permanently
              </button>
            </SignInButton>
          </div>
        )}

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library..."
          className="h-9"
        />

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {loading
              ? "Loading..."
              : items.length === 0
                ? "Nothing saved yet. Use the Save button on any AI response or generated image to add it here."
                : "No items match your search."}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {filtered.map((it) => (
              <li key={it.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {it.item_type} · {new Date(it.created_at).toLocaleDateString()}
                  </div>
                  {it.content_text && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                      {it.content_text.slice(0, 240)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => remove(it.id)}
                  className="p-1.5 rounded hover:bg-accent transition active:scale-95"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
