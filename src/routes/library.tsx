import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Download,
  FileText,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  List,
  MoreHorizontal,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

type FilterId = "all" | "recent" | "favorites" | "images" | "documents" | "other";
type SortId = "newest" | "oldest" | "name" | "size";
type ViewId = "grid" | "list";

import { loadGuestLibrary, deleteGuestItem } from "@/lib/guest-library";

const VIEW_KEY = "kova-library-view";
const FAVORITES_KEY = "kova-library-favorites";

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeFavorites(ids: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids].slice(0, 1000)));
}

function isImageItem(it: LibItem) {
  return Boolean(it.file_url && (it.item_type === "image" || it.file_type?.startsWith("image/")));
}

function isDocumentItem(it: LibItem) {
  return (
    ["upload", "document", "code", "chat_artifact", "website_draft"].includes(it.item_type) &&
    !isImageItem(it)
  );
}

function humanBytes(n: number | null | undefined): string | null {
  if (typeof n !== "number") return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function LibraryPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("newest");
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === "undefined") return "grid";
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  });
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());

  const load = async () => {
    setLoadError(null);
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
      setLoadError(e instanceof Error ? e.message : "Could not load your library.");
      toast.error("Could not load your library.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const remove = async (id: string) => {
    const existing = items;
    if (!confirm("Delete this Library item?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (!isSignedIn) {
      deleteGuestItem(id);
      toast.success("Deleted.");
      return;
    }

    try {
      const { deleteLibraryItem } = await import("@/lib/library.functions");
      await deleteLibraryItem({ data: { id } });
      toast.success("Deleted.");
    } catch (e) {
      setItems(existing);
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === "recent") {
          const age = Date.now() - new Date(item.created_at).getTime();
          if (age > 1000 * 60 * 60 * 24 * 30) return false;
        }
        if (filter === "favorites" && !favorites.has(item.id)) return false;
        if (filter === "images" && !isImageItem(item)) return false;
        if (filter === "documents" && !isDocumentItem(item)) return false;
        if (filter === "other" && (isImageItem(item) || isDocumentItem(item))) return false;
        if (!q) return true;
        return [
          item.title,
          item.file_name,
          item.file_type,
          item.item_type,
          item.source,
          item.content_text,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sort === "name") return a.title.localeCompare(b.title);
        if (sort === "size") return (b.file_size ?? -1) - (a.file_size ?? -1);
        const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return sort === "oldest" ? -delta : delta;
      });
  }, [favorites, filter, items, query, sort]);

  const storageKnown = items.some((item) => typeof item.file_size === "number");
  const storageTotal = storageKnown
    ? items.reduce((sum, item) => sum + (item.file_size ?? 0), 0)
    : null;

  const filters: Array<{ id: FilterId; label: string }> = [
    { id: "all", label: "All" },
    { id: "recent", label: "Recent" },
    { id: "favorites", label: "Favorites" },
    { id: "images", label: "Images" },
    { id: "documents", label: "Documents" },
    { id: "other", label: "Other" },
  ];

  const renderActions = (item: LibItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--kova-radius-input)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Actions for ${item.title}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {item.file_url ? (
          <DropdownMenuItem asChild>
            <a href={item.file_url} target="_blank" rel="noreferrer">
              <Download className="mr-2 h-4 w-4" /> Open or download
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => toggleFavorite(item.id)}>
          <Star className="mr-2 h-4 w-4" /> {favorites.has(item.id) ? "Unfavorite" : "Favorite"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => remove(item.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderItem = (item: LibItem) => {
    const image = isImageItem(item);
    const size = humanBytes(item.file_size);
    const meta = [
      item.item_type.replace(/_/g, " "),
      size,
      new Date(item.created_at).toLocaleDateString(),
    ]
      .filter(Boolean)
      .join(" · ");
    if (view === "list") {
      return (
        <li
          key={item.id}
          className="kova-row min-h-14 items-center gap-3"
          data-library-item={item.item_type}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--kova-radius-input)] bg-[var(--surface-secondary)] text-muted-foreground">
            {image ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.title}</div>
            <div className="truncate text-xs text-muted-foreground">{meta}</div>
          </div>
          {favorites.has(item.id) ? (
            <Star className="h-4 w-4 fill-current text-amber-500" aria-label="Favorite" />
          ) : null}
          {renderActions(item)}
        </li>
      );
    }

    return (
      <li
        key={item.id}
        className="group kova-card overflow-hidden"
        data-library-item={item.item_type}
      >
        {image ? (
          <div className="aspect-square overflow-hidden bg-[var(--surface-secondary)]">
            <img
              src={item.file_url!}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </div>
        ) : (
          <div className="aspect-[4/3] bg-[var(--surface-secondary)] p-4 text-xs text-muted-foreground">
            <div className="line-clamp-6 whitespace-pre-wrap">
              {(item.content_text ?? item.file_name ?? item.title).slice(0, 320)}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</div>
          </div>
          {favorites.has(item.id) ? (
            <Star
              className="mt-2 h-4 w-4 shrink-0 fill-current text-amber-500"
              aria-label="Favorite"
            />
          ) : null}
          {renderActions(item)}
        </div>
      </li>
    );
  };

  return (
    <AppShell>
      <main className="kova-page" aria-labelledby="library-title">
        <header className="kova-page-header">
          <div className="min-w-0">
            <h1 id="library-title" className="kova-page-title">
              Library
            </h1>
            <p className="kova-page-description">
              Saved files, images, responses, and reusable context.
            </p>
            {storageTotal !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Known file storage: {humanBytes(storageTotal)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Storage totals require backend usage records and are omitted here.
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </header>

        {!isSignedIn && isLoaded ? (
          <section className="kova-card p-4 text-sm" aria-label="Guest Library notice">
            <div className="font-medium">You are browsing as a guest.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Items you save stay in this browser. Sign in to keep them across devices.
            </p>
            <SignInButton mode="modal">
              <button className="mt-3 min-h-10 rounded-full bg-foreground px-4 text-xs font-medium text-background hover:opacity-90">
                Sign in to save permanently
              </button>
            </SignInButton>
          </section>
        ) : null}

        <section className="kova-toolbar" aria-label="Library toolbar">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search Library</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Library"
              className="h-10 rounded-[var(--kova-radius-input)] pl-9"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortId)}
            className="kova-select"
            aria-label="Sort Library"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          <div
            className="flex rounded-[var(--kova-radius-input)] border border-border p-1"
            role="group"
            aria-label="Library view"
          >
            <button
              type="button"
              className={`kova-icon-button ${view === "grid" ? "bg-[var(--surface-selected)]" : ""}`}
              onClick={() => setView("grid")}
              aria-label="Grid view"
            >
              <Grid2X2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`kova-icon-button ${view === "list" ? "bg-[var(--surface-selected)]" : ""}`}
              onClick={() => setView("list")}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </section>

        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Library filters"
        >
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${filter === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-[var(--surface-secondary)] text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loadError ? (
          <section className="kova-empty-state" role="alert">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 font-medium">Could not load Library</h2>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <Button className="mt-4" onClick={load}>
              Retry
            </Button>
          </section>
        ) : loading && items.length === 0 ? (
          <ul className="kova-grid" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <li
                key={index}
                className="h-52 rounded-[var(--kova-radius-card)] bg-[var(--skeleton-base)] animate-pulse"
              />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <section className="kova-empty-state">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 font-medium">
              {items.length === 0 ? "Your Library is empty" : "No matches"}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {items.length === 0
                ? "Save responses, generated images, research reports, or uploads and they will appear here."
                : `Nothing matches “${query}”.`}
            </p>
          </section>
        ) : (
          <ul className={view === "list" ? "kova-list" : "kova-grid"} aria-label="Library items">
            {filtered.map(renderItem)}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
