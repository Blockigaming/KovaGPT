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
  const [tab, setTab] = useState<"all" | "images" | "documents">("all");

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
    const isImage = !!(it.file_url && (it.item_type === "image" || it.file_type?.startsWith("image/")));
    if (tab === "images" && !isImage) return false;
    if (tab === "documents" && isImage) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return it.title.toLowerCase().includes(q) || (it.content_text ?? "").toLowerCase().includes(q);
  });

  return (
    <AppShell>
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="w-full px-4 sm:px-6 lg:px-10 py-3 flex items-center gap-3">
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

      <main className="w-full px-4 sm:px-6 lg:px-10 py-6 space-y-4">
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

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40">
            {([
              { id: "all" as const, label: "All" },
              { id: "images" as const, label: "Images" },
              { id: "documents" as const, label: "Documents" },
            ]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition ${
                  tab === t.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library..."
            className="h-10 max-w-md"
          />
        </div>

        {loading && items.length === 0 ? (
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="aspect-square bg-muted animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="h-2.5 w-1/2 rounded bg-muted animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="w-full rounded-xl border border-dashed border-border p-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            {items.length === 0 ? (
              <>
                <div className="text-base font-medium mb-1">Your library is empty</div>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Save any AI response, upload, or generated image with the Save button: It'll appear here so you can find it later.
                </p>
              </>
            ) : (
              <>
                <div className="text-base font-medium mb-1">No matches</div>
                <p className="text-sm text-muted-foreground">Nothing in your library matches "{query}".</p>
              </>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">

            {filtered.map((it) => {
              const isImage = it.file_url && (it.item_type === "image" || it.file_type?.startsWith("image/"));
              return (
                <li
                  key={it.id}
                  className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-foreground/30 transition"
                >
                  {isImage ? (
                    <div className="aspect-square bg-muted overflow-hidden">
                      <img
                        src={it.file_url!}
                        alt={it.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  ) : (
                    <div className="aspect-square bg-gradient-to-br from-muted/40 to-muted/10 flex items-center justify-center p-4">
                      <div className="text-xs text-muted-foreground line-clamp-6 whitespace-pre-wrap">
                        {(it.content_text ?? it.title).slice(0, 300)}
                      </div>
                    </div>
                  )}
                  <div className="p-3">
                    <div className="text-sm font-medium truncate">{it.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {it.item_type} · {new Date(it.created_at).toLocaleDateString()}
                    </div>
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
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 backdrop-blur opacity-0 group-hover:opacity-100 transition hover:bg-destructive hover:text-destructive-foreground active:scale-95"
                    title="Delete"
                    aria-label="Delete item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

    </AppShell>
  );
}
