import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
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
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { SharedChatInbox, SharedChatSummary } from "@/lib/shared-chats.functions";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Library" },
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
import {
  chatStoragePrincipal,
  clearPendingActive,
  loadConversations,
  saveConversations,
  saveDraft,
} from "@/lib/chat-store";
import { loadWorkTasks, saveWorkTasks } from "@/lib/work-store";
import { isPrivateLibraryImagePath, resolveLibraryImageUrl } from "@/lib/library-image-url";
import { safeImageUrl } from "@/lib/safe-image-url";
import { safeNavigationUrl } from "@/lib/safe-url";
import {
  addManyToContextPack,
  addToContextPack,
  continueInResearch,
  openInWork,
  type WorkspaceHandoff,
} from "@/lib/workspace-handoffs";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

const VIEW_KEY = "kova-library-view";
const FAVORITES_KEY = "kova-library-favorites";
const EMPTY_LIBRARY_ITEMS: LibItem[] = [];
const EMPTY_RECEIVED_SHARES: SharedChatInbox[] = [];
const EMPTY_SENT_SHARES: SharedChatSummary[] = [];

function readFavorites(key: string | null): Set<string> {
  if (!key) return new Set();
  try {
    return new Set(JSON.parse(safeBrowserStorage("localStorage")?.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function writeFavorites(key: string | null, ids: Set<string>) {
  if (!key) return;
  safeBrowserStorage("localStorage")?.setItem(key, JSON.stringify([...ids].slice(0, 1000)));
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

type LibraryImageSourceState = {
  itemId: string | null;
  url: string | null;
  status: "idle" | "loading" | "error" | "ready";
};

function useLibraryImageSource(item: LibItem | null) {
  const itemId = item?.id ?? null;
  const fileUrl = item?.file_url ?? null;
  const directUrl = safeImageUrl(fileUrl);
  const privatePath = isPrivateLibraryImagePath(fileUrl);
  const [state, setState] = useState<LibraryImageSourceState>({
    itemId: null,
    url: null,
    status: "idle",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const retryRef = useRef<{ itemId: string | null; count: number }>({ itemId: null, count: 0 });

  const retry = useCallback(() => {
    if (!itemId || !fileUrl || directUrl || !privatePath) return;
    if (retryRef.current.itemId !== itemId) retryRef.current = { itemId, count: 0 };
    if (retryRef.current.count >= 2) {
      setState({ itemId, url: null, status: "error" });
      return;
    }
    retryRef.current.count += 1;
    setState({ itemId, url: null, status: "loading" });
    setRefreshKey((current) => current + 1);
  }, [directUrl, fileUrl, itemId, privatePath]);

  const markLoaded = useCallback(() => {
    retryRef.current = { itemId, count: 0 };
  }, [itemId]);

  useEffect(() => {
    if (!itemId || !fileUrl || directUrl || !privatePath) return;
    let cancelled = false;
    if (retryRef.current.itemId !== itemId) retryRef.current = { itemId, count: 0 };
    setState({ itemId, url: null, status: "loading" });

    void (async () => {
      try {
        const { getLibraryImageUrl } = await import("@/lib/library-images.functions");
        const url = await resolveLibraryImageUrl({ id: itemId, file_url: fileUrl }, (id) =>
          getLibraryImageUrl({ data: { id } }),
        );
        if (!url) throw new Error("Invalid signed image URL");
        if (!cancelled) setState({ itemId, url, status: "ready" });
      } catch {
        if (!cancelled) setState({ itemId, url: null, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directUrl, fileUrl, itemId, privatePath, refreshKey]);

  if (directUrl) return { url: directUrl, loading: false, error: false, retry, markLoaded };
  if (!privatePath)
    return { url: null, loading: false, error: Boolean(fileUrl), retry, markLoaded };
  if (state.itemId !== itemId) return { url: null, loading: true, error: false, retry, markLoaded };
  return {
    url: state.url,
    loading: state.status === "loading",
    error: state.status === "error",
    retry,
    markLoaded,
  };
}

function LibraryImageMedia({
  item,
  className,
  fallbackClassName = "",
}: {
  item: LibItem;
  className: string;
  fallbackClassName?: string;
}) {
  const image = useLibraryImageSource(item);
  if (image.url) {
    return (
      <img
        src={image.url}
        alt={item.title}
        loading="lazy"
        className={className}
        onLoad={image.markLoaded}
        onError={image.retry}
      />
    );
  }
  return (
    <div
      className={`flex h-full min-h-24 flex-col items-center justify-center gap-2 text-muted-foreground ${fallbackClassName}`}
      role="status"
    >
      <ImageIcon className="h-6 w-6" aria-hidden="true" />
      <span className="text-xs">
        {image.loading ? "Loading image…" : "Image preview unavailable"}
      </span>
    </div>
  );
}

function LibraryImageDownloadAction({ item }: { item: LibItem }) {
  const image = useLibraryImageSource(item);
  if (image.url) {
    return (
      <DropdownMenuItem asChild>
        <a href={image.url} target="_blank" rel="noopener noreferrer">
          <Download className="mr-2 h-4 w-4" /> Open or download
        </a>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem disabled>
      <Download className="mr-2 h-4 w-4" />
      {image.loading ? "Preparing image…" : "Image unavailable"}
    </DropdownMenuItem>
  );
}

function LibraryPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const favoritesKey = isLoaded ? principalScopedStorageKey(FAVORITES_KEY, userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const lifecycleGenerationRef = useRef(0);
  const [itemState, setItemState] = useState<{
    principal: string | null;
    items: LibItem[];
  }>({ principal: null, items: [] });
  const principalReady = principal !== null && itemState.principal === principal;
  const items = principalReady ? itemState.items : EMPTY_LIBRARY_ITEMS;
  const setItems = useCallback(
    (next: SetStateAction<LibItem[]>) => {
      setItemState((previous) => {
        if (principal === null || principalRef.current !== principal) return previous;
        const current = previous.principal === principal ? previous.items : [];
        return {
          principal,
          items: typeof next === "function" ? next(current) : next,
        };
      });
    },
    [principal],
  );
  const loadGenerationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("newest");
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === "undefined") return "grid";
    return safeBrowserStorage("localStorage")?.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesPrincipal, setFavoritesPrincipal] = useState<string | null>(null);
  const favoritesReady = principal !== null && favoritesPrincipal === principal;
  const visibleFavorites = useMemo(
    () => (favoritesReady ? favorites : new Set<string>()),
    [favorites, favoritesReady],
  );
  const [previewItem, setPreviewItem] = useState<LibItem | null>(null);
  const visiblePreviewItem = principalReady ? previewItem : null;
  const previewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const shareLoadGenerationRef = useRef(0);
  const [shareState, setShareState] = useState<{
    principal: string | null;
    received: SharedChatInbox[];
    sent: SharedChatSummary[];
    loading: boolean;
    error: string | null;
  }>({ principal: null, received: [], sent: [], loading: false, error: null });
  const sharesReady = principal !== null && shareState.principal === principal;
  const receivedShares = sharesReady ? shareState.received : EMPTY_RECEIVED_SHARES;
  const sentShares = sharesReady ? shareState.sent : EMPTY_SENT_SHARES;
  const sharesLoading = Boolean(isSignedIn) && (!sharesReady || shareState.loading);
  const sharesError = sharesReady ? shareState.error : null;
  const [sharedPreview, setSharedPreview] = useState<SharedChatInbox | null>(null);
  const visibleSharedPreview = sharesReady ? sharedPreview : null;
  const sharedPreviewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [pendingRevokeShare, setPendingRevokeShare] = useState<SharedChatSummary | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    const generation = ++shareLoadGenerationRef.current;
    if (!isLoaded || principal === null || !isSignedIn) {
      setShareState({
        principal,
        received: [],
        sent: [],
        loading: false,
        error: null,
      });
      return;
    }
    const requestPrincipal = principal;
    const isCurrent = () =>
      shareLoadGenerationRef.current === generation && principalRef.current === requestPrincipal;
    setSharedPreview(null);
    setShareState({
      principal: requestPrincipal,
      received: [],
      sent: [],
      loading: true,
      error: null,
    });
    try {
      const { listMySharedChats, listSharedWithMe } = await import("@/lib/shared-chats.functions");
      const [received, sent] = await Promise.all([listSharedWithMe(), listMySharedChats()]);
      if (!isCurrent()) return;
      setShareState({
        principal: requestPrincipal,
        received,
        sent,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setShareState({
        principal: requestPrincipal,
        received: [],
        sent: [],
        loading: false,
        error: error instanceof Error ? error.message : "Shared chats could not be loaded.",
      });
    }
  }, [isLoaded, isSignedIn, principal]);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!isLoaded || principal === null) return;
    const isCurrent = () =>
      loadGenerationRef.current === generation && principalRef.current === principal;
    setLoadError(null);
    const localItems: LibItem[] = [
      ...loadConversations(userKey).map((chat): LibItem => ({
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
      })),
      ...loadWorkTasks(userKey).map((task): LibItem => ({
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
      })),
    ];
    if (!isSignedIn) {
      if (isCurrent()) {
        setItems([...localItems, ...loadGuestLibrary()]);
        setLoading(false);
      }
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
      if (isCurrent()) setItems([...localItems, ...saved, ...workspaceItems]);
    } catch (e) {
      if (!isCurrent()) return;
      console.error("[library] load failed");
      setLoadError(e instanceof Error ? e.message : "Could not load your library.");
      toast.error("Could not load your library.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [isLoaded, isSignedIn, principal, setItems, userKey]);

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    setQuery("");
    setFilter("all");
    setSort("newest");
    setPreviewItem(null);
    setSelected([]);
    setLoadError(null);
    setSharedPreview(null);
    setPendingRevokeShare(null);
    setRevokingShareId(null);
    shareLoadGenerationRef.current += 1;
    setShareState({
      principal,
      received: [],
      sent: [],
      loading: false,
      error: null,
    });
    if (!principal || !favoritesKey) {
      setFavorites(new Set());
      setFavoritesPrincipal(null);
      return;
    }
    setFavorites(readFavorites(favoritesKey));
    setFavoritesPrincipal(principal);
  }, [favoritesKey, principal]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      loadGenerationRef.current += 1;
      lifecycleGenerationRef.current += 1;
      setItemState({ principal, items: [] });
      setFavorites(new Set());
      setFavoritesPrincipal(principal);
      setPreviewItem(null);
      setSharedPreview(null);
      setPendingRevokeShare(null);
      setRevokingShareId(null);
      shareLoadGenerationRef.current += 1;
      setShareState({
        principal,
        received: [],
        sent: [],
        loading: false,
        error: null,
      });
      setSelected([]);
      setQuery("");
      setFilter("all");
      setSort("newest");
      setLoading(false);
      setLoadError(null);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  useEffect(() => {
    if (!isLoaded || principal === null) {
      loadGenerationRef.current += 1;
      shareLoadGenerationRef.current += 1;
      setItemState({ principal: null, items: [] });
      setShareState({
        principal: null,
        received: [],
        sent: [],
        loading: false,
        error: null,
      });
      setLoading(false);
      setLoadError(null);
      return;
    }
    void load();
    void loadShares();
  }, [isLoaded, load, loadShares, principal]);

  useEffect(() => {
    safeBrowserStorage("localStorage")?.setItem(VIEW_KEY, view);
  }, [view]);

  const [pendingDelete, setPendingDelete] = useState<
    { kind: "one"; id: string } | { kind: "many" } | null
  >(null);
  const remove = async (id: string, confirmed = false) => {
    if (!principalReady || !principal) return;
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === lifecycleGenerationRef.current && principalRef.current === requestPrincipal;
    const existing = items;
    if (!confirmed) {
      setPendingDelete({ kind: "one", id });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (id.startsWith("chat:")) {
      saveConversations(
        userKey,
        loadConversations(userKey).filter((chat) => `chat:${chat.id}` !== id),
      );
      toast.success("Chat deleted.");
      return;
    }
    if (id.startsWith("work:")) {
      saveWorkTasks(
        userKey,
        loadWorkTasks(userKey).filter((task) => `work:${task.id}` !== id),
      );
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
      if (isCurrent()) toast.success("Deleted.");
    } catch {
      if (!isCurrent()) return;
      setItems(existing);
      toast.error("Could not delete this Library item. Please try again.");
    }
  };

  const toggleFavorite = (id: string) => {
    if (!favoritesReady || !favoritesKey) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(favoritesKey, next);
      return next;
    });
  };

  const revokeShare = async (id: string) => {
    if (!sharesReady || !principal) return;
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === lifecycleGenerationRef.current && principalRef.current === requestPrincipal;
    setRevokingShareId(id);
    try {
      const { revokeSharedChat } = await import("@/lib/shared-chats.functions");
      await revokeSharedChat({ data: { id } });
      if (!isCurrent()) return;
      setShareState((previous) =>
        previous.principal === requestPrincipal
          ? {
              ...previous,
              sent: previous.sent.map((share) =>
                share.id === id ? { ...share, status: "revoked" } : share,
              ),
            }
          : previous,
      );
      toast.success("Share revoked.");
    } catch {
      if (isCurrent()) toast.error("Could not revoke this shared snapshot. Please try again.");
    } finally {
      if (isCurrent()) setRevokingShareId(null);
    }
  };

  const deleteSelected = async (confirmed = false) => {
    if (!principalReady || !principal) return;
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === lifecycleGenerationRef.current && principalRef.current === requestPrincipal;
    if (!selected.length) return;
    if (!confirmed) {
      setPendingDelete({ kind: "many" });
      return;
    }
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
          if (!isCurrent()) return;
          throw new Error("Some selected items could not be deleted. Library was refreshed.");
        }
      } else {
        selected
          .filter((id) => !id.startsWith("chat:") && !id.startsWith("work:"))
          .forEach(deleteGuestItem);
      }
      if (!isCurrent()) return;
      saveConversations(
        userKey,
        loadConversations(userKey).filter((chat) => !selected.includes(`chat:${chat.id}`)),
      );
      saveWorkTasks(
        userKey,
        loadWorkTasks(userKey).filter((task) => !selected.includes(`work:${task.id}`)),
      );
      setSelected([]);
      toast.success("Selected items deleted.");
    } catch {
      if (!isCurrent()) return;
      if (!isSignedIn) setItems(existing);
      toast.error("Some selected items could not be deleted. Review your Library and try again.");
    }
  };

  const reuseInChat = (item: LibItem) => {
    const context = item.content_text?.trim()
      ? `Use this saved Library item as context:\n\n${item.content_text.slice(0, 20_000)}`
      : `Help me work with this saved Library item: ${item.title}`;
    try {
      saveDraft(userKey, null, context);
      clearPendingActive(userKey);
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
        if (filter === "favorites" && !visibleFavorites.has(item.id)) return false;
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
  }, [filter, items, query, sort, visibleFavorites]);

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
          className="flex h-11 w-11 items-center justify-center rounded-[var(--kova-radius-input)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Actions for ${item.title}`}
          onFocus={(event) => {
            previewReturnFocusRef.current = event.currentTarget;
          }}
          onPointerDown={(event) => {
            previewReturnFocusRef.current = event.currentTarget;
          }}
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
        <DropdownMenuItem onClick={() => openInWork(toHandoff(item), userKey)}>
          Open in Work
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => continueInResearch(toHandoff(item), userKey)}>
          Continue Research
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => addToContextPack(toHandoff(item), userKey)}>
          Add to Context Pack
        </DropdownMenuItem>
        {isImageItem(item) ? (
          <LibraryImageDownloadAction item={item} />
        ) : safeNavigationUrl(item.file_url) ? (
          <DropdownMenuItem asChild>
            <a href={safeNavigationUrl(item.file_url)!} target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" /> Open or download
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => toggleFavorite(item.id)}>
          <Star className="mr-2 h-4 w-4" />{" "}
          {visibleFavorites.has(item.id) ? "Unfavorite" : "Favorite"}
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
          {visibleFavorites.has(item.id) ? (
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
          <label className="absolute z-10 m-3 grid h-11 w-11 place-items-center rounded-lg bg-background/85">
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
            <LibraryImageMedia item={item} className="h-full w-full object-cover" />
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
          {visibleFavorites.has(item.id) ? (
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
      <main
        id="main-content"
        tabIndex={-1}
        className="kova-page kova-secondary-page"
        aria-labelledby="library-title"
      >
        <WorkspacePageHeader
          title="Library"
          titleId="library-title"
          description="Chats, work, files, images, responses, and reusable context in one place."
          meta={
            storageTotal !== null ? `Known file storage: ${humanBytes(storageTotal)}` : undefined
          }
          actions={
            principalReady ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  void load();
                  void loadShares();
                }}
                disabled={loading || sharesLoading}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`mr-1.5 h-3.5 w-3.5 ${loading || sharesLoading ? "animate-spin motion-reduce:animate-none" : ""}`}
                />{" "}
                Refresh
              </Button>
            ) : null
          }
        />

        {!isSignedIn && isLoaded ? (
          <section
            className="flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/25 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
            aria-labelledby="guest-library-title"
          >
            <div>
              <h2 id="guest-library-title" className="font-medium">
                Saved in this browser
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Guest items stay on this device. Sign in to keep new items across devices.
              </p>
            </div>
            <SignInButton mode="modal">
              <Button size="sm" className="min-h-11 shrink-0">
                Sign in
              </Button>
            </SignInButton>
          </section>
        ) : null}

        {isSignedIn && isLoaded ? (
          <section className="kova-card space-y-4 p-4 sm:p-5" aria-labelledby="shared-chats-title">
            <div>
              <h2 id="shared-chats-title" className="font-medium">
                Shared chats
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open read-only snapshots shared with you, or revoke snapshots you sent.
              </p>
            </div>
            {sharesError ? (
              <div role="alert" className="rounded-xl border border-destructive/30 p-4">
                <p className="text-sm font-medium text-destructive">Could not load shared chats</p>
                <p className="mt-1 text-xs text-muted-foreground">{sharesError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 min-h-11"
                  onClick={() => void loadShares()}
                >
                  Retry
                </Button>
              </div>
            ) : sharesLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading shared chats…
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Shared with me</h3>
                  {receivedShares.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                      No chats have been shared with you.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {receivedShares.map((share) => (
                        <li key={share.id} className="flex min-h-14 items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{share.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {share.snapshot.messages.length} messages ·{" "}
                              {new Date(share.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11 shrink-0"
                            onClick={(event) => {
                              sharedPreviewReturnFocusRef.current = event.currentTarget;
                              setSharedPreview(share);
                            }}
                          >
                            Open snapshot
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Shared by me</h3>
                  {sentShares.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                      You have not shared a chat. Use Share chat from a conversation to send a
                      read-only snapshot.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {sentShares.map((share) => (
                        <li key={share.id} className="flex min-h-14 items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{share.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              To {share.recipient_email} · {share.status} ·{" "}
                              {new Date(share.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          {share.status !== "revoked" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 shrink-0"
                              disabled={revokingShareId === share.id}
                              onClick={() => setPendingRevokeShare(share)}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {items.length > 0 && !loadError ? (
          <>
            <section className="kova-toolbar" aria-label="Library toolbar">
              <label className="relative min-w-[220px] flex-1">
                <span className="sr-only">Search Library</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Library"
                  className="h-11 rounded-[var(--kova-radius-input)] pl-9"
                />
              </label>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
                className="kova-select min-h-11"
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
                  className={`kova-icon-button min-h-11 min-w-11 ${view === "grid" ? "bg-[var(--surface-selected)]" : ""}`}
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                >
                  <Grid2X2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`kova-icon-button min-h-11 min-w-11 ${view === "list" ? "bg-[var(--surface-selected)]" : ""}`}
                  onClick={() => setView("list")}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </section>

            <div
              className="flex gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label="Library filters"
            >
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition ${filter === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-[var(--surface-secondary)] text-muted-foreground hover:text-foreground"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {selected.length && !loadError ? (
          <section
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3"
            aria-label="Selected Library actions"
          >
            <span className="text-sm font-medium">{selected.length} selected</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => setSelected([])}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  if (!favoritesReady || !favoritesKey) return;
                  const next = new Set(visibleFavorites);
                  selected.forEach((id) => next.add(id));
                  setFavorites(next);
                  writeFavorites(favoritesKey, next);
                }}
              >
                Favorite
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  addManyToContextPack(
                    items.filter((item) => selected.includes(item.id)).map(toHandoff),
                    userKey,
                  )
                }
              >
                Add to Context Pack
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="min-h-11"
                onClick={() => void deleteSelected()}
              >
                Delete
              </Button>
            </div>
          </section>
        ) : null}

        {loadError ? (
          <section className="kova-empty-state" role="alert">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 font-medium">Could not load Library</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your saved items are temporarily unavailable. Try again in a moment.
            </p>
            <Button className="mt-4 min-h-11" onClick={load}>
              Retry
            </Button>
          </section>
        ) : loading && items.length === 0 ? (
          <section role="status" aria-labelledby="library-loading-title">
            <h2 id="library-loading-title" className="sr-only">
              Loading Library
            </h2>
            <ul className="kova-grid" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <li
                  key={index}
                  className="h-52 animate-pulse rounded-[var(--kova-radius-card)] bg-[var(--skeleton-base)] motion-reduce:animate-none"
                />
              ))}
            </ul>
          </section>
        ) : filtered.length === 0 ? (
          <section className="kova-empty-state" aria-labelledby="library-empty-title">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 id="library-empty-title" className="mt-3 font-medium">
              {items.length === 0
                ? isSignedIn
                  ? "Your Library is empty"
                  : "Nothing saved in this browser"
                : "No matches"}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {items.length === 0
                ? "Save a response, generated image, research report, or upload to find it here."
                : `Nothing matches “${query}”.`}
            </p>
          </section>
        ) : (
          <ul className={view === "list" ? "kova-list" : "kova-grid"} aria-label="Library items">
            {filtered.map(renderItem)}
          </ul>
        )}
        <Dialog
          open={Boolean(visiblePreviewItem)}
          onOpenChange={(open) => {
            if (!open) setPreviewItem(null);
          }}
        >
          {visiblePreviewItem ? (
            <DialogContent
              className="gap-0 overflow-hidden p-0 sm:w-[min(92vw,768px)] sm:max-w-3xl sm:p-0 [&>div[aria-hidden]:first-child]:mt-2"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = previewReturnFocusRef.current;
                if (trigger?.isConnected) trigger.focus();
                previewReturnFocusRef.current = null;
              }}
            >
              <header className="flex items-center gap-3 border-b border-border p-4 pr-16">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate text-base">
                    {visiblePreviewItem.title}
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {visiblePreviewItem.item_type.replace(/_/g, " ")} ·{" "}
                    {new Date(visiblePreviewItem.created_at).toLocaleDateString()}
                  </DialogDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => reuseInChat(visiblePreviewItem)}
                >
                  Reuse in chat
                </Button>
              </header>
              <div className="max-h-[70dvh] overflow-auto p-4 sm:p-6">
                {isImageItem(visiblePreviewItem) ? (
                  <LibraryImageMedia
                    item={visiblePreviewItem}
                    className="mx-auto max-h-[65dvh] rounded-xl object-contain"
                    fallbackClassName="min-h-64 rounded-xl bg-[var(--surface-secondary)]"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {visiblePreviewItem.content_text ||
                      visiblePreviewItem.file_name ||
                      "No preview is available for this item."}
                  </pre>
                )}
              </div>
            </DialogContent>
          ) : null}
        </Dialog>
        <Dialog
          open={Boolean(visibleSharedPreview)}
          onOpenChange={(open) => {
            if (!open) setSharedPreview(null);
          }}
        >
          {visibleSharedPreview ? (
            <DialogContent
              className="gap-0 overflow-hidden p-0 sm:w-[min(92vw,768px)] sm:max-w-3xl sm:p-0"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = sharedPreviewReturnFocusRef.current;
                if (trigger?.isConnected) trigger.focus();
                sharedPreviewReturnFocusRef.current = null;
              }}
            >
              <header className="border-b border-border p-4 pr-16">
                <DialogTitle className="truncate text-base">
                  {visibleSharedPreview.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Read-only snapshot · {visibleSharedPreview.snapshot.messages.length} messages ·{" "}
                  shared {new Date(visibleSharedPreview.created_at).toLocaleDateString()}
                </DialogDescription>
              </header>
              <ol className="max-h-[70dvh] space-y-4 overflow-auto p-4 sm:p-6">
                {visibleSharedPreview.snapshot.messages.map((message, index) => (
                  <li key={`${visibleSharedPreview.id}:${index}`} className="space-y-1">
                    <p className="text-xs font-medium capitalize text-muted-foreground">
                      {message.role}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {message.content}
                    </p>
                  </li>
                ))}
              </ol>
            </DialogContent>
          ) : null}
        </Dialog>
        <ConfirmActionDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete this Library item?"
          description="This action permanently removes the selected content."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const pending = pendingDelete;
            setPendingDelete(null);
            if (pending?.kind === "one") void remove(pending.id, true);
            else if (pending?.kind === "many") void deleteSelected(true);
          }}
        />
        <ConfirmActionDialog
          open={pendingRevokeShare !== null}
          onOpenChange={(open) => !open && setPendingRevokeShare(null)}
          title="Revoke this shared snapshot?"
          description={
            pendingRevokeShare
              ? `${pendingRevokeShare.recipient_email} will no longer be able to open “${pendingRevokeShare.title}”.`
              : "The recipient will no longer be able to open this snapshot."
          }
          confirmLabel="Revoke"
          destructive
          onConfirm={() => {
            const share = pendingRevokeShare;
            setPendingRevokeShare(null);
            if (share) void revokeShare(share.id);
          }}
        />
      </main>
    </AppShell>
  );
}
