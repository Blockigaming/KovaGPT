import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  List,
  MoreHorizontal,
  MessageSquarePlus,
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

type FilterId = "all" | "favorites" | "chats" | "work" | "images" | "documents" | "other";
type SortId = "newest" | "oldest" | "name" | "size";
type ViewId = "grid" | "list";

import { loadGuestLibrary, deleteGuestItem } from "@/lib/guest-library";
import { loadConversations, saveConversations } from "@/lib/chat-store";
import { loadWorkTasks, saveWorkTasks } from "@/lib/work-store";
import { safeNavigationUrl } from "@/lib/safe-url";
import {
  addManyToContextPack,
  addToContextPack,
  continueInResearch,
  openInWork,
  type WorkspaceHandoff,
} from "@/lib/workspace-handoffs";

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
  const [previewItem, setPreviewItem] = useState<LibItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = async () => {
    setLoadError(null);
    const localItems: LibItem[] = [
      ...loadConversations().map(
        (chat): LibItem => ({
          id: `chat:${chat.id}`,
          title: chat.title,
          item_type: "chat_artifact",
          source: "chat",
          content_text: chat.messages
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n\n"),
          file_url: null,
          file_name: null,
          file_type: "application/x-kova-chat",
          file_size: null,
          created_at: new Date(chat.updatedAt).toISOString(),
        }),
      ),
      ...loadWorkTasks().map(
        (task): LibItem => ({
          id: `work:${task.id}`,
          title: task.objective,
          item_type: "other",
          source: "other",
          content_text: [
            task.context,
            ...task.steps.map((step) => `${step.done ? "✓" : "○"} ${step.text}`),
          ]
            .filter(Boolean)
            .join("\n"),
          file_url: null,
          file_name: null,
          file_type: "application/x-kova-work",
          file_size: null,
          created_at: new Date(task.updatedAt).toISOString(),
        }),
      ),
    ];
    if (!isSignedIn) {
      setItems([...localItems, ...loadGuestLibrary()]);
      return;
    }
    setLoading(true);
    try {
      const { listMyLibrary } = await import("@/lib/library.functions");
      const { listWorkspaceRecents } = await import("@/lib/workspace.functions");
      const [saved, workspace] = await Promise.all([listMyLibrary(), listWorkspaceRecents()]);
      const savedIds = new Set(saved.map((item) => item.id));
      const workspaceItems: LibItem[] = workspace
        .filter((item) => item.type !== "library" && !savedIds.has(item.id))
        .map((item) => ({
          id: `workspace:${item.type}:${item.id}`,
          title: item.title,
          item_type: item.type === "image" ? "image" : "other",
          source: "other",
          content_text: item.subtitle,
          file_url: null,
          file_name: null,
          file_type: `application/x-kova-${item.type}`,
          file_size: null,
          created_at: item.updatedAt,
        }));
      setItems([...localItems, ...saved, ...workspaceItems]);
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

  useEffect(() => {
    if (!previewItem) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewItem(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewItem]);

  const remove = async (id: string) => {
    const existing = items;
    if (!confirm("Delete this Library item?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (id.startsWith("chat:")) {
      saveConversations(loadConversations().filter((chat) => `chat:${chat.id}` !== id));
      toast.success("Chat deleted.");
      return;
    }
    if (id.startsWith("work:")) {
      saveWorkTasks(loadWorkTasks().filter((task) => `work:${task.id}` !== id));
      toast.success("Work item deleted.");
      return;
    }
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

  const deleteSelected = async () => {
    if (!selected.length || !confirm(`Delete ${selected.length} selected Library items?`)) return;
    const existing = items;
    setItems((current) => current.filter((item) => !selected.includes(item.id)));
    try {
      if (isSignedIn) {
        const { deleteLibraryItem } = await import("@/lib/library.functions");
        const results = await Promise.allSettled(
          selected
            .filter((id) => !id.startsWith("chat:") && !id.startsWith("work:"))
            .map((id) => deleteLibraryItem({ data: { id } })),
        );
        if (results.some((result) => result.status === "rejected")) {
          await load();
          throw new Error("Some selected items could not be deleted. Library was refreshed.");
        }
      } else {
        selected
          .filter((id) => !id.startsWith("chat:") && !id.startsWith("work:"))
          .forEach(deleteGuestItem);
      }
      saveConversations(
        loadConversations().filter((chat) => !selected.includes(`chat:${chat.id}`)),
      );
      saveWorkTasks(loadWorkTasks().filter((task) => !selected.includes(`work:${task.id}`)));
      setSelected([]);
      toast.success("Selected items deleted.");
    } catch (error) {
      if (!isSignedIn) setItems(existing);
      toast.error(error instanceof Error ? error.message : "Selected items could not be deleted.");
    }
  };

  const reuseInChat = (item: LibItem) => {
    const context = item.content_text?.trim()
      ? `Use this saved Library item as context:\n\n${item.content_text.slice(0, 20_000)}`
      : `Help me work with this saved Library item: ${item.title}`;
    try {
      localStorage.setItem("kova-draft:__new__", context);
      localStorage.removeItem("nova-gpt-pending-active");
    } catch {
      toast.error("Could not prepare this item for chat.");
      return;
    }
    window.location.href = "/";
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === "favorites" && !favorites.has(item.id)) return false;
        if (filter === "chats" && !item.id.startsWith("chat:")) return false;
        if (filter === "work" && !item.id.startsWith("work:")) return false;
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
    { id: "favorites", label: "Favorites" },
    { id: "chats", label: "Chats" },
    { id: "work", label: "Work" },
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
        <DropdownMenuItem onClick={() => setPreviewItem(item)}>
          <Eye className="mr-2 h-4 w-4" /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => reuseInChat(item)}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Reuse in chat
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openInWork(toHandoff(item))}>
          Open in Work
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => continueInResearch(toHandoff(item))}>
          Continue Research
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => addToContextPack(toHandoff(item))}>
          Add to Context Pack
        </DropdownMenuItem>
        {safeNavigationUrl(item.file_url) ? (
          <DropdownMenuItem asChild>
            <a href={safeNavigationUrl(item.file_url)!} target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" /> Open or download
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => toggleFavorite(item.id)}>
          <Star className="mr-2 h-4 w-4" /> {favorites.has(item.id) ? "Unfavorite" : "Favorite"}
        </DropdownMenuItem>
        {!item.id.startsWith("workspace:") ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => remove(item.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const toHandoff = (item: LibItem): WorkspaceHandoff => ({
    type: isImageItem(item) ? "image" : isDocumentItem(item) ? "artifact" : "library",
    id: item.id,
    title: item.title,
    content: item.content_text ?? item.file_url ?? "Saved Library item",
  });

  const renderItem = (item: LibItem) => {
    const image = isImageItem(item);
    const workspaceReference = item.id.startsWith("workspace:");
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
          {!workspaceReference ? (
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() =>
                setSelected((current) =>
                  current.includes(item.id)
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id],
                )
              }
              aria-label={`Select ${item.title}`}
              className="h-4 w-4 shrink-0"
            />
          ) : null}
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
        className="group kova-card relative overflow-hidden"
        data-library-item={item.item_type}
      >
        {!workspaceReference ? (
          <label className="absolute z-10 m-3 grid h-9 w-9 place-items-center rounded-lg bg-background/85 shadow-sm">
            <span className="sr-only">Select {item.title}</span>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() =>
                setSelected((current) =>
                  current.includes(item.id)
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id],
                )
              }
              className="h-4 w-4"
            />
          </label>
        ) : null}
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
      <main className="kova-page kova-secondary-page" aria-labelledby="library-title">
        <header className="kova-page-header">
          <div className="min-w-0">
            <h1 id="library-title" className="kova-page-title">
              Library
            </h1>
            <p className="kova-page-description">
              Chats, work, files, images, responses, and reusable context in one place.
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

        {selected.length ? (
          <section
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3"
            aria-label="Selected Library actions"
          >
            <span className="text-sm font-medium">{selected.length} selected</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = new Set(favorites);
                  selected.forEach((id) => next.add(id));
                  setFavorites(next);
                  writeFavorites(next);
                }}
              >
                Favorite
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  addManyToContextPack(
                    items.filter((item) => selected.includes(item.id)).map(toHandoff),
                  )
                }
              >
                Add to Context Pack
              </Button>
              <Button size="sm" variant="destructive" onClick={deleteSelected}>
                Delete
              </Button>
            </div>
          </section>
        ) : null}

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
        {previewItem ? (
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-preview-title"
            onClick={() => setPreviewItem(null)}
          >
            <section
              className="kova-glass max-h-[90dvh] w-full overflow-hidden rounded-t-2xl sm:max-w-3xl sm:rounded-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center gap-3 border-b border-border p-4">
                <div className="min-w-0 flex-1">
                  <h2 id="library-preview-title" className="truncate font-semibold">
                    {previewItem.title}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {previewItem.item_type.replace(/_/g, " ")} ·{" "}
                    {new Date(previewItem.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => reuseInChat(previewItem)}>
                  Reuse in chat
                </Button>
                <button
                  className="kova-icon-button"
                  aria-label="Close preview"
                  onClick={() => setPreviewItem(null)}
                  autoFocus
                >
                  ×
                </button>
              </header>
              <div className="max-h-[70dvh] overflow-auto p-4 sm:p-6">
                {isImageItem(previewItem) ? (
                  <img
                    src={previewItem.file_url!}
                    alt={previewItem.title}
                    className="mx-auto max-h-[65dvh] rounded-xl object-contain"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {previewItem.content_text ||
                      previewItem.file_name ||
                      "No preview is available for this item."}
                  </pre>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
