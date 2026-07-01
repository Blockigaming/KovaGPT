import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Trash2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";

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
      setItems(loadGuestLibrary());
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
      deleteGuestItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
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
    <AppShell>
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
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
              Items you save stay in this browser. Sign in to keep them across devices and free up
              local storage.
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
          <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
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
                {it.file_url && (it.item_type === "image" || it.file_type?.startsWith("image/")) && (
                  <img
                    src={it.file_url}
                    alt={it.title}
                    className="w-14 h-14 rounded-md object-cover border border-border shrink-0"
                  />
                )}
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
                  {it.file_url && it.item_type === "upload" && !it.file_type?.startsWith("image/") && (
                    <a
                      href={it.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-foreground/80 underline mt-1 inline-block"
                    >
                      Open file
                    </a>
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
    </AppShell>
  );
}
