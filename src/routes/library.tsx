import "@/styles/file-directories.css";
import "@/styles/spec400-management.css";
import { LibraryRenameDialog } from "@/components/LibraryRenameDialog";
import { LibraryDocumentPreview } from "@/components/LibraryDocumentPreview";
import { createLibraryDocumentViewMemory } from "@/lib/library-document-preview";
import { LibrarySelectedDownloadsDialog } from "@/components/LibrarySelectedDownloadsDialog";
import { selectedLibraryDownloadSnapshot } from "@/lib/library-selected-downloads";
import { ChatTrashPanel } from "@/components/ChatTrashPanel";
import { libraryListMetadata } from "@/lib/library-list-metadata";
import { LibraryUploadDialog } from "@/components/LibraryUploadDialog";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { WorkOutputDownloadAction } from "@/components/WorkOutputDownloadAction";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
  type MouseEvent,
} from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { formatDisplayDateTime } from "@/lib/time-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  libraryDetailKey,
  libraryItemDetailPath,
  libraryItemDetailSearch,
  libraryModifiedAt,
  validateLibraryDetailSearch,
} from "@/lib/library-detail";
import { useLibraryDetail } from "@/hooks/use-library-detail";
import {
  Upload,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  List,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  MessageSquarePlus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SharedChatInbox, SharedChatSummary } from "@/lib/shared-chats.functions";
import {
  LibraryFolderOrganizer,
  type LibraryFolderScope,
} from "@/components/LibraryFolderOrganizer";

function savedChatLibraryItems(userKey: string | null): LibItem[] {
  return loadConversations(userKey).map((chat): LibItem => ({
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
  }));
}

function savedWorkLibraryItems(userKey: string | null): LibItem[] {
  return loadWorkTasks(userKey).map((task): LibItem => ({
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
  }));
}

export const Route = createFileRoute("/library")({
  component: LibraryPage,
  validateSearch: validateLibraryDetailSearch,
  head: () => ({
    meta: [
      { title: "KovaGPT Library" },
      { name: "description", content: "Your saved chats, files, and generated images in KovaGPT." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type LibItem = import("@/lib/library.functions").LibraryItem;
const LibraryVersionsDialog = lazy(() =>
  import("@/components/LibraryVersionsDialog").then((m) => ({ default: m.LibraryVersionsDialog })),
);
const StorageDashboard = lazy(() =>
  import("@/components/StorageDashboard").then((m) => ({ default: m.StorageDashboard })),
);

type FilterId =
  "all" | "favorites" | "chats" | "work" | "images" | "documents" | "uploads" | "code" | "other";
type SortId = "newest" | "oldest" | "name" | "size";
type ViewId = "grid" | "list";

import { loadGuestLibrary, deleteGuestItem } from "@/lib/guest-library";
import {
  chatStoragePrincipal,
  clearPendingActive,
  loadConversations,
  saveDraft,
} from "@/lib/chat-store";
import { moveChatToTrash, readChatTrash } from "@/lib/chat-trash";
import { libraryDeleteConfirmation } from "@/lib/library-delete-confirmation";
import { loadWorkTasks, saveWorkTasks } from "@/lib/work-store";
import { useWorkStoreRevision } from "@/hooks/use-work-store-revision";
import { isPrivateLibraryImagePath, resolveLibraryImageUrl } from "@/lib/library-image-url";
import { observeLibraryImageApproach, queueLibraryImageSigning } from "@/lib/library-image-loading";
import { safeImageUrl } from "@/lib/safe-image-url";
import { safeNavigationUrl } from "@/lib/safe-url";
import {
  addManyToContextPack,
  addToContextPack,
  continueInChat,
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function useLibraryImageSource(item: LibItem | null, enabled = true) {
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
    if (!enabled || !itemId || !fileUrl || directUrl || !privatePath) return;
    if (retryRef.current.itemId !== itemId) retryRef.current = { itemId, count: 0 };
    if (retryRef.current.count >= 2) {
      setState({ itemId, url: null, status: "error" });
      return;
    }
    retryRef.current.count += 1;
    setState({ itemId, url: null, status: "loading" });
    setRefreshKey((current) => current + 1);
  }, [directUrl, enabled, fileUrl, itemId, privatePath]);

  const markLoaded = useCallback(() => {
    retryRef.current = { itemId, count: 0 };
  }, [itemId]);

  useEffect(() => {
    if (!enabled || !itemId || !fileUrl || directUrl || !privatePath) return;
    let cancelled = false;
    if (retryRef.current.itemId !== itemId) retryRef.current = { itemId, count: 0 };
    setState({ itemId, url: null, status: "loading" });

    void (async () => {
      try {
        const url = await queueLibraryImageSigning(
          async () => {
            const { getLibraryImageUrl } = await import("@/lib/library-images.functions");
            if (cancelled) return null;
            return resolveLibraryImageUrl({ id: itemId, file_url: fileUrl }, (id) =>
              getLibraryImageUrl({ data: { id } }),
            );
          },
          () => cancelled,
        );
        if (cancelled) return;
        if (!url) throw new Error("Invalid signed image URL");
        if (!cancelled) setState({ itemId, url, status: "ready" });
      } catch {
        if (!cancelled) setState({ itemId, url: null, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directUrl, enabled, fileUrl, itemId, privatePath, refreshKey]);

  if (directUrl) return { url: directUrl, loading: false, error: false, retry, markLoaded };
  if (!privatePath)
    return { url: null, loading: false, error: Boolean(fileUrl), retry, markLoaded };
  if (!enabled) return { url: null, loading: false, error: false, retry, markLoaded };
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
  eager = false,
}: {
  item: LibItem;
  className: string;
  fallbackClassName?: string;
  eager?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemKey = `${item.id}:${item.file_url ?? ""}`;
  const [approachedItem, setApproachedItem] = useState<string | null>(null);
  const enabled = eager || approachedItem === itemKey;
  const image = useLibraryImageSource(item, enabled);

  useEffect(() => {
    if (eager || !containerRef.current) return;
    return observeLibraryImageApproach(containerRef.current, () => setApproachedItem(itemKey));
  }, [eager, itemKey]);

  return (
    <div ref={containerRef} className={eager ? undefined : "h-full w-full"}>
      {image.url ? (
        <img
          src={image.url}
          alt={item.title}
          loading={eager ? "eager" : "lazy"}
          className={className}
          onLoad={image.markLoaded}
          onError={image.retry}
        />
      ) : (
        <div
          className={`flex h-full min-h-24 flex-col items-center justify-center gap-2 text-muted-foreground ${fallbackClassName}`}
          role="status"
        >
          <ImageIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs">
            {image.loading
              ? "Loading image…"
              : image.error
                ? "Image preview unavailable"
                : "Image preview"}
          </span>
        </div>
      )}
    </div>
  );
}

function LibraryImageDownloadAction({ item }: { item: LibItem }) {
  const image = useLibraryImageSource(item);
  if (image.url) {
    return (
      <DropdownMenuItem asChild>
        <a href={image.url} target="_blank" rel="noopener noreferrer">
          <Download className="h-4 w-4" /> Open or download
        </a>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem disabled>
      <Download className="h-4 w-4" />
      {image.loading ? "Preparing image…" : "Image unavailable"}
    </DropdownMenuItem>
  );
}

function LibraryPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const timeFormat = useTimeFormatPreference(user?.id ?? null, isLoaded);
  const detailSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const detailKey = libraryDetailKey(detailSearch);
  const detailKeyRef = useRef(detailKey);
  detailKeyRef.current = detailKey;
  const userKey = user?.id ?? null;
  const ownerIdRef = useRef(userKey);
  ownerIdRef.current = userKey;
  const workRevision = useWorkStoreRevision(userKey);
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
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const retryReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    principal: string | null;
    generation: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [libraryCleared, setLibraryCleared] = useState(false);
  // Survives details closing, but never an account change, route unmount or data reset.
  const documentViewMemory = useMemo(
    () =>
      createLibraryDocumentViewMemory(isLoaded && isSignedIn && !libraryCleared ? userKey : null),
    [isLoaded, isSignedIn, userKey, libraryCleared],
  );
  const [storageDetailsOpen, setStorageDetailsOpen] = useState(false);
  const foldersDetailsRef = useRef<HTMLDetailsElement>(null);
  const detail = useLibraryDetail({
    search: detailSearch,
    ownerId: isSignedIn ? userKey : null,
    accountLoaded: isLoaded,
    cleared: libraryCleared,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [nextPage, setNextPage] = useState<Record<string, unknown> | null>(null);
  const pageCursor = useRef<Record<string, unknown> | null>(null);
  const pageRequests = useRef(new Set<AbortController>());
  const [versionItem, setVersionItem] = useState<LibItem | null>(null);
  const versionReturnFocusRef = useRef<{
    trigger: HTMLButtonElement | null;
    url: string;
    principal: string;
    generation: number;
  } | null>(null);
  const versionMenuHandoffRef = useRef(new Set<string>());
  const renameMenuHandoffRef = useRef(new Set<string>());
  const [renameTarget, setRenameTarget] = useState<{
    item: LibItem;
    owner: string;
    principal: string;
    generation: number;
    url: string;
  } | null>(null);
  const renameOriginRef = useRef<typeof renameTarget>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const requests = pageRequests.current;
    return () => {
      lifecycleGenerationRef.current += 1;
      versionReturnFocusRef.current = null;
      bulkDeleteRef.current = null;
      retryReturnRef.current = null;
      for (const controller of requests) controller.abort();
      requests.clear();
    };
  }, []);
  const [filter, setFilter] = useState<FilterId>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [trashOwner, setTrashOwner] = useState<{
    principal: string | null;
    generation: number;
  } | null>(null);
  const trashTriggerRef = useRef<HTMLButtonElement | null>(null);
  const trashOriginRef = useRef<{
    principal: string | null;
    generation: number;
    url: string;
  } | null>(null);
  const [previewView, setPreviewView] = useState<"preview" | "text">("preview");
  const [sort, setSort] = useState<SortId>("newest");
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === "undefined") return "list";
    return safeBrowserStorage("localStorage")?.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesPrincipal, setFavoritesPrincipal] = useState<string | null>(null);
  const favoritesReady = principal !== null && favoritesPrincipal === principal;
  const visibleFavorites = useMemo(
    () => (favoritesReady ? favorites : new Set<string>()),
    [favorites, favoritesReady],
  );
  const [previewItem, setPreviewItem] = useState<LibItem | null>(null);
  const visiblePreviewItem = detailKey ? detail.item : principalReady ? previewItem : null;
  const previewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const librarySearchRef = useRef<HTMLInputElement | null>(null);
  const libraryRootRef = useRef<HTMLElement | null>(null);
  const previewOriginRef = useRef<{ url: string; principal: string | null } | null>(null);
  const detailHistoryRef = useRef<{ key: string; principal: string | null } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [downloadTarget, setDownloadTarget] = useState<{
    snapshot: ReturnType<typeof selectedLibraryDownloadSnapshot>;
    trigger: HTMLButtonElement;
    owner: string | null;
    principal: string;
    generation: number;
    url: string;
  } | null>(null);
  const downloadOriginRef = useRef<typeof downloadTarget>(null);
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", () => {
        downloadOriginRef.current = null;
        setDownloadTarget(null);
      }),
    [router],
  );

  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const bulkDeleteRef = useRef<{ principal: string; generation: number } | null>(null);
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
  const [folderScopeState, setFolderScopeState] = useState<{
    principal: string | null;
    scope: LibraryFolderScope;
  }>({ principal: null, scope: "all" });
  const folderScopeReady = principal !== null && folderScopeState.principal === principal;
  // Hide the outgoing account's selection before the new principal hydrates.
  const folderScope = folderScopeReady ? folderScopeState.scope : "all";
  const setFolderScope = useCallback(
    (scope: LibraryFolderScope) => {
      if (!principal || principalRef.current !== principal) return;
      setFolderScopeState({ principal, scope });
    },
    [principal],
  );
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);
  const [folderBusy, setFolderBusy] = useState(false);
  const selectedDurableIds = useMemo(
    () => selected.filter((id) => UUID_PATTERN.test(id)),
    [selected],
  );

  const favoriteIds = useMemo(
    () =>
      [...visibleFavorites]
        .filter((id) => UUID_PATTERN.test(id))
        .sort()
        .join(","),
    [visibleFavorites],
  );
  const load = useCallback(
    async (more = false) => {
      const generation = ++loadGenerationRef.current;
      if (
        !isLoaded ||
        principal === null ||
        !folderScopeReady ||
        libraryCleared ||
        (isSignedIn && !userKey)
      )
        return;
      const isCurrent = () =>
        loadGenerationRef.current === generation && principalRef.current === principal;
      setLoadError(null);
      if (!more) {
        pageCursor.current = null;
        setNextPage(null);
        setSelected([]);
      }
      const controller = new AbortController();
      pageRequests.current.add(controller);
      const localItems: LibItem[] = [
        ...savedChatLibraryItems(userKey),
        ...savedWorkLibraryItems(userKey),
      ];
      if (!isSignedIn) {
        if (isCurrent()) {
          setItems([...localItems, ...loadGuestLibrary()]);
          setLoading(false);
        }
        pageRequests.current.delete(controller);
        return;
      }
      setLoading(true);
      try {
        const { listLibraryPage } = await import("@/lib/library-items-client");
        const { listWorkspaceRecents } = await import("@/lib/workspace.functions");
        if (!isCurrent()) return;
        const [page, workspace] = await Promise.all([
          listLibraryPage(
            userKey!,
            {
              query: searchQuery,
              sort,
              filter: ["chats", "work", "uploads", "code"].includes(filter) ? "all" : filter,
              folder: folderScope,
              favorites: favoriteIds,
              cursor: more ? pageCursor.current : null,
            },
            controller.signal,
          ),
          more ? Promise.resolve([]) : listWorkspaceRecents(),
        ]);
        const saved = ["chats", "work"].includes(filter) ? [] : page.items;
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
        if (isCurrent()) {
          pageCursor.current = ["chats", "work"].includes(filter) ? null : page.cursor;
          setNextPage(pageCursor.current);
          setItems((previous) =>
            more
              ? [
                  ...previous,
                  ...saved.filter((item) => !previous.some((old) => old.id === item.id)),
                ]
              : [...localItems, ...saved, ...workspaceItems],
          );
        }
      } catch (e) {
        if (!isCurrent()) return;
        console.error("[library] load failed");
        setLoadError(e instanceof Error ? e.message : "Could not load your library.");
        setSelected([]);
        toast.error("Could not load your library.");
      } finally {
        pageRequests.current.delete(controller);
        if (isCurrent()) setLoading(false);
      }
    },
    [
      isLoaded,
      isSignedIn,
      principal,
      setItems,
      userKey,
      searchQuery,
      sort,
      filter,
      folderScope,
      folderScopeReady,
      favoriteIds,
      libraryCleared,
    ],
  );

  useEffect(() => {
    if (!isLoaded || !principalReady) return;
    setItems((current) => [
      ...current.filter((item) => !item.id.startsWith("work:")),
      ...savedWorkLibraryItems(userKey),
    ]);
  }, [isLoaded, principalReady, setItems, userKey, workRevision]);

  const refreshLibrary = useCallback(() => {
    if (folderBusy) return;
    setFolderRefreshKey((current) => current + 1);
    void load();
  }, [folderBusy, load]);

  useEffect(() => {
    if (!loading || !retryReturnRef.current) return;
    const relinquishFocus = (event: Event) => {
      const origin = retryReturnRef.current;
      if (!origin || event.target === origin.trigger) return;
      if (event.type === "pointerdown" || event.target !== document.body)
        retryReturnRef.current = null;
    };
    document.addEventListener("focusin", relinquishFocus);
    document.addEventListener("pointerdown", relinquishFocus);
    return () => {
      document.removeEventListener("focusin", relinquishFocus);
      document.removeEventListener("pointerdown", relinquishFocus);
    };
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    const origin = retryReturnRef.current;
    retryReturnRef.current = null;
    if (!origin || !loadError) return;
    const active = document.activeElement;
    restoreDialogFocus(
      retryButtonRef.current,
      origin.url,
      libraryCleared ||
        origin.principal !== principalRef.current ||
        origin.generation !== loadGenerationRef.current ||
        (active !== null && active !== document.body && active !== origin.trigger),
    );
  }, [loading, loadError, libraryCleared]);

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    retryReturnRef.current = null;
    for (const controller of pageRequests.current) controller.abort();
    pageRequests.current.clear();
    pageCursor.current = null;
    setNextPage(null);
    setVersionItem(null);
    versionReturnFocusRef.current = null;
    bulkDeleteRef.current = null;
    setBulkDeleteBusy(false);
    setLibraryCleared(false);
    let saved: Record<string, string> = {};
    if (principal) {
      try {
        const value = JSON.parse(
          safeBrowserStorage("sessionStorage")?.getItem(`kova-library-filters:${principal}`) ||
            "{}",
        );
        if (value && typeof value === "object" && !Array.isArray(value)) saved = value;
      } catch {
        /* optional preference */
      }
    }
    const savedQuery = typeof saved.query === "string" ? saved.query : "";
    setQuery(savedQuery);
    setSearchQuery(savedQuery.trim());
    setFilter(
      [
        "all",
        "favorites",
        "chats",
        "work",
        "images",
        "documents",
        "uploads",
        "code",
        "other",
      ].includes(saved.filter)
        ? (saved.filter as FilterId)
        : "all",
    );
    setSort(
      ["newest", "oldest", "name", "size"].includes(saved.sort) ? (saved.sort as SortId) : "newest",
    );
    setSourceFilter(
      ["all", "upload", "chat", "images", "manual", "other"].includes(saved.source)
        ? saved.source
        : "all",
    );
    setDateFilter(["all", "7", "30", "90"].includes(saved.date) ? saved.date : "all");
    setUploadOpen(false);
    setPreviewItem(null);
    setStorageDetailsOpen(false);
    previewReturnFocusRef.current = null;
    previewOriginRef.current = null;
    detailHistoryRef.current = null;
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
    const savedFolder = typeof saved.folder === "string" ? saved.folder : "all";
    setFolderScopeState({
      principal,
      // The keyed organizer validates durable IDs against the current owned
      // folders after its successful load, including deleted/foreign IDs.
      scope:
        principal &&
        principal !== "guest" &&
        (savedFolder === "unfiled" || UUID_PATTERN.test(savedFolder))
          ? savedFolder.toLowerCase()
          : "all",
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
      if (
        principalRef.current !== principal ||
        !isPrincipalBrowserStorageClearedEvent(event, userKey)
      )
        return;
      loadGenerationRef.current += 1;
      lifecycleGenerationRef.current += 1;
      for (const controller of pageRequests.current) controller.abort();
      pageRequests.current.clear();
      pageCursor.current = null;
      setNextPage(null);
      setVersionItem(null);
      versionReturnFocusRef.current = null;
      bulkDeleteRef.current = null;
      setBulkDeleteBusy(false);
      setLibraryCleared(true);
      setItemState({ principal, items: [] });
      setFavorites(new Set());
      setFavoritesPrincipal(principal);
      setPreviewItem(null);
      setStorageDetailsOpen(false);
      previewReturnFocusRef.current = null;
      previewOriginRef.current = null;
      detailHistoryRef.current = null;
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
      setFolderScopeState({ principal, scope: "all" });
      setSelected([]);
      setQuery("");
      setSearchQuery("");
      setFilter("all");
      setSourceFilter("all");
      setDateFilter("all");
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
  }, [isLoaded, load, principal]);
  useEffect(() => {
    if (isLoaded && principal && !libraryCleared) void loadShares();
  }, [isLoaded, principal, loadShares, libraryCleared]);

  useEffect(() => {
    safeBrowserStorage("localStorage")?.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    setSelected([]);
  }, [folderScope]);

  type PendingLibraryDelete = {
    kind: "one" | "many";
    items: Array<LibItem & { temporary?: boolean }>;
    principal: string;
    generation: number;
    retentionMs: number | null;
  };
  const [pendingDelete, setPendingDelete] = useState<PendingLibraryDelete | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteActionButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const deleteMenuHandoffRef = useRef(new Set<string>());
  const deleteReturnFocusRef = useRef<{
    trigger: HTMLButtonElement | null;
    url: string;
    principal: string;
    generation: number;
  } | null>(null);
  const confirmedDeleteRef = useRef<PendingLibraryDelete | null>(null);
  const visiblePendingDelete =
    pendingDelete &&
    pendingDelete.principal === principal &&
    pendingDelete.generation === lifecycleGenerationRef.current &&
    !libraryCleared
      ? pendingDelete
      : null;
  const deleteSummary = libraryDeleteConfirmation(
    visiblePendingDelete?.items ?? [],
    visiblePendingDelete?.retentionMs ?? null,
  );
  useEffect(() => {
    setPendingDelete(null);
    setDeleteDialogOpen(false);
    deleteReturnFocusRef.current = null;
    confirmedDeleteRef.current = null;
    return () => {
      deleteReturnFocusRef.current = null;
      confirmedDeleteRef.current = null;
    };
  }, [principal, libraryCleared]);
  const beginLibraryDelete = (
    kind: "one" | "many",
    targets: LibItem[],
    trigger: HTMLButtonElement | null,
  ) => {
    if (
      !principalReady ||
      !principal ||
      folderBusy ||
      bulkDeleteBusy ||
      libraryCleared ||
      !targets.length
    )
      return;
    try {
      const hasChats = targets.some((item) => item.id.startsWith("chat:"));
      const chats = hasChats ? loadConversations(userKey) : [];
      const retentionMs = hasChats ? readChatTrash(userKey).retentionMs : null;
      const generation = lifecycleGenerationRef.current;
      const snapshot = targets.map((item) => ({
        ...item,
        temporary: Boolean(chats.find((chat) => `chat:${chat.id}` === item.id)?.temporary),
      }));
      deleteReturnFocusRef.current = {
        trigger,
        url: window.location.href,
        principal,
        generation,
      };
      if (kind === "one") deleteMenuHandoffRef.current.add(targets[0].id);
      confirmedDeleteRef.current = null;
      setPendingDelete({ kind, items: snapshot, principal, generation, retentionMs });
      setDeleteDialogOpen(true);
    } catch {
      toast.error("Your Trash setting could not be read. Nothing was deleted. Try again.");
    }
  };
  const remove = async (id: string, confirmed = false) => {
    if (!principalReady || !principal || folderBusy) return;
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === lifecycleGenerationRef.current && principalRef.current === requestPrincipal;
    const existing = items;
    const restoreDeletedItem = () => {
      const deleted = existing.find((item) => item.id === id);
      if (!deleted) return;
      setItems((current) => {
        if (current.some((item) => item.id === id)) return current;
        const restored = current.slice();
        restored.splice(Math.min(existing.indexOf(deleted), restored.length), 0, deleted);
        return restored;
      });
    };
    if (!confirmed) {
      const target = existing.find((item) => item.id === id);
      if (target)
        beginLibraryDelete("one", [target], deleteActionButtonsRef.current.get(id) ?? null);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (id.startsWith("chat:")) {
      try {
        const chats = loadConversations(userKey);
        const chat = chats.find((item) => `chat:${item.id}` === id);
        if (!chat || !(await moveChatToTrash(userKey, chat, chats, isCurrent))) {
          if (isCurrent()) restoreDeletedItem();
          return;
        }
        if (isCurrent()) toast.success("Chat removed using your Trash retention setting.");
      } catch {
        if (isCurrent()) {
          restoreDeletedItem();
          toast.error("Could not save chat removal. Your recoverable copy has been kept.");
        }
      }
      return;
    }
    if (id.startsWith("work:")) {
      try {
        saveWorkTasks(
          userKey,
          loadWorkTasks(userKey).filter((task) => `work:${task.id}` !== id),
        );
        toast.success("Work item deleted.");
      } catch {
        if (!isCurrent()) return;
        restoreDeletedItem();
        toast.error("Work item could not be deleted. Retry Work sync and try again.");
      }
      return;
    }
    if (!isSignedIn) {
      try {
        deleteGuestItem(id);
        if (isCurrent()) toast.success("Deleted.");
      } catch {
        if (isCurrent()) {
          restoreDeletedItem();
          toast.error("Could not save this deletion. Your Library item has been kept.");
        }
      }
      return;
    }

    try {
      const { deleteLibraryItem } = await import("@/lib/library.functions");
      await deleteLibraryItem({
        data: {
          id,
          expectedOwnerId: userKey ?? undefined,
          generation: existing.find((item) => item.id === id)?.original_generation,
          contentGeneration: existing.find((item) => item.id === id)?.content_generation,
          revision: existing.find((item) => item.id === id)?.content_revision,
        },
      });
      if (isCurrent()) toast.success("Deleted.");
    } catch {
      if (!isCurrent()) return;
      restoreDeletedItem();
      toast.error("Could not delete this Library item. Please try again.");
    }
  };

  const toggleFavorite = (id: string) => {
    if (!favoritesReady || !favoritesKey) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 1000) {
          toast.error("Library supports up to 1,000 favorites.");
          return prev;
        }
        next.add(id);
      }
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

  const deleteSelected = async (
    confirmed = false,
    ids = selected,
    trigger: HTMLButtonElement | null = null,
  ) => {
    if (!principalReady || !principal || folderBusy) return;
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === lifecycleGenerationRef.current && principalRef.current === requestPrincipal;
    if (!ids.length) return;
    if (!confirmed) {
      beginLibraryDelete(
        "many",
        items.filter((item) => ids.includes(item.id)),
        trigger,
      );
      return;
    }
    if (
      bulkDeleteRef.current?.principal === requestPrincipal &&
      bulkDeleteRef.current.generation === generation
    )
      return;
    const operation = { principal: requestPrincipal, generation };
    bulkDeleteRef.current = operation;
    setBulkDeleteBusy(true);
    const existing = items;
    // The mixed operation is not atomic. Reconcile only confirmed successes;
    // canceled, failed and not-yet-attempted targets keep their current rows.
    const reconcileDeleted = (completedIds: string[]) => {
      if (!isCurrent() || completedIds.length === 0) return;
      const completed = new Set(completedIds);
      setItems((current) =>
        isCurrent() ? current.filter((item) => !completed.has(item.id)) : current,
      );
      setSelected((current) =>
        isCurrent() ? current.filter((id) => !completed.has(id)) : current,
      );
    };
    try {
      const savedIds = ids.filter((id) => !id.startsWith("chat:") && !id.startsWith("work:"));
      if (isSignedIn && savedIds.length) {
        const { deleteLibraryItem } = await import("@/lib/library.functions");
        if (!isCurrent()) return;
        const results = await Promise.allSettled(
          savedIds.map((id) =>
            deleteLibraryItem({
              data: {
                id,
                expectedOwnerId: userKey ?? undefined,
                generation: existing.find((item) => item.id === id)?.original_generation,
                contentGeneration: existing.find((item) => item.id === id)?.content_generation,
                revision: existing.find((item) => item.id === id)?.content_revision,
              },
            }),
          ),
        );
        if (!isCurrent()) return;
        reconcileDeleted(savedIds.filter((_, index) => results[index].status === "fulfilled"));
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Some selected items could not be deleted.");
      } else if (!isSignedIn) {
        for (const id of savedIds) {
          if (!isCurrent()) return;
          deleteGuestItem(id);
          reconcileDeleted([id]);
        }
      }
      if (!isCurrent()) return;
      for (const id of ids.filter((value) => value.startsWith("chat:"))) {
        if (!isCurrent()) return;
        const chats = loadConversations(userKey);
        const chat = chats.find((item) => `chat:${item.id}` === id);
        if (chat && !(await moveChatToTrash(userKey, chat, chats, isCurrent)))
          throw new Error("Chat removal was canceled or could not be saved.");
        reconcileDeleted([id]);
      }
      if (!isCurrent()) return;
      const workIds = ids.filter((id) => id.startsWith("work:"));
      if (workIds.length) {
        saveWorkTasks(
          userKey,
          loadWorkTasks(userKey).filter((task) => !workIds.includes(`work:${task.id}`)),
        );
        reconcileDeleted(workIds);
      }
      if (isCurrent()) toast.success("Selected items deleted.");
    } catch {
      if (!isCurrent()) return;
      toast.error(
        "Some removals were canceled or could not be confirmed. Review the remaining items and try again.",
      );
    } finally {
      if (bulkDeleteRef.current === operation) {
        bulkDeleteRef.current = null;
        if (isCurrent()) setBulkDeleteBusy(false);
      }
    }
  };

  const withItem = async (item: LibItem, action: (value: LibItem) => void) => {
    const owner = userKey,
      version = lifecycleGenerationRef.current,
      requestedDetail = detailKeyRef.current;
    if (!principal) return;
    const controller = new AbortController();
    pageRequests.current.add(controller);
    const current = () =>
      owner === ownerIdRef.current &&
      version === lifecycleGenerationRef.current &&
      requestedDetail === detailKeyRef.current &&
      !controller.signal.aborted;
    try {
      const value =
        item.content_loaded === false
          ? (await import("@/lib/library-items-client")).readLibraryItem
          : null;
      const loaded = value ? await value(owner!, item, controller.signal) : item;
      if (current()) action(loaded);
    } catch {
      if (current()) toast.error("This item could not be opened. Refresh Library and try again.");
    } finally {
      pageRequests.current.delete(controller);
    }
  };
  const openItemPreview = (item: LibItem) => {
    if (!principalReady || libraryCleared) return;
    const search = isSignedIn ? libraryItemDetailSearch(item) : null;
    if (search && detailHistoryRef.current?.key === libraryDetailKey(search)) return;
    previewOriginRef.current = { url: window.location.href, principal };
    setPreviewView("preview");
    if (search) {
      setPreviewItem(null);
      setVersionItem(null);
      detailHistoryRef.current = { key: libraryDetailKey(search)!, principal };
      void navigate({ search, resetScroll: false });
    } else {
      // Browser-only chat/work/guest records have no authenticated detail URL.
      setPreviewItem(item);
    }
  };
  const closeItemPreview = () => {
    setPreviewItem(null);
    if (!detailKey) return;
    const origin = detailHistoryRef.current;
    detailHistoryRef.current = null;
    if (origin?.key === detailKey && origin.principal === principal) router.history.back();
    else void navigate({ search: {}, replace: true, resetScroll: false });
  };
  const copyItemLink = async (item: LibItem) => {
    const path = libraryItemDetailPath(item);
    if (!path || !isSignedIn || !userKey || libraryCleared) return;
    const owner = userKey;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      if (ownerIdRef.current === owner)
        toast.success("Link copied. Sign-in and access are still required.");
    } catch {
      if (ownerIdRef.current === owner) toast.error("The link could not be copied. Try again.");
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

  const folderItems = useMemo(
    () =>
      items.filter((item) => {
        if (folderScope === "unfiled") return UUID_PATTERN.test(item.id) && !item.folder_id;
        if (folderScope !== "all") return item.folder_id === folderScope;
        return true;
      }),
    [folderScope, items],
  );

  useEffect(() => {
    if (!principal || !folderScopeReady || libraryCleared) return;
    try {
      safeBrowserStorage("sessionStorage")?.setItem(
        `kova-library-filters:${principal}`,
        JSON.stringify({
          query,
          filter,
          sort,
          source: sourceFilter,
          date: dateFilter,
          folder: folderScope,
        }),
      );
    } catch {
      /* optional preference */
    }
  }, [
    principal,
    query,
    filter,
    sort,
    sourceFilter,
    dateFilter,
    folderScope,
    folderScopeReady,
    libraryCleared,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return folderItems
      .filter((item) => {
        if (filter === "favorites" && !visibleFavorites.has(item.id)) return false;
        if (filter === "chats" && !item.id.startsWith("chat:")) return false;
        if (filter === "work" && !item.id.startsWith("work:")) return false;
        if (filter === "uploads" && item.source !== "upload" && item.item_type !== "upload")
          return false;
        if (filter === "code" && item.item_type !== "code") return false;
        if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
        if (
          dateFilter !== "all" &&
          Date.now() - Date.parse(item.created_at) > Number(dateFilter) * 86400000
        )
          return false;
        if (filter === "images" && !isImageItem(item)) return false;
        if (filter === "documents" && !isDocumentItem(item)) return false;
        if (filter === "other" && (isImageItem(item) || isDocumentItem(item))) return false;
        if (!q || (isSignedIn && UUID_PATTERN.test(item.id) && searchQuery === query.trim()))
          return true;
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
  }, [
    filter,
    folderItems,
    query,
    sort,
    visibleFavorites,
    isSignedIn,
    searchQuery,
    sourceFilter,
    dateFilter,
  ]);

  const storageKnown = items.some((item) => typeof item.file_size === "number");
  const storageTotal = storageKnown
    ? items.reduce((sum, item) => sum + (item.file_size ?? 0), 0)
    : null;

  const filters: Array<{ id: FilterId; label: string }> = [
    { id: "all", label: "All" },
    { id: "uploads", label: "Uploads" },
    { id: "documents", label: "Documents" },
    { id: "images", label: "Images" },
    { id: "code", label: "Code" },
  ];

  const renderActions = (item: LibItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-ui-reference="chatgpt.library.item-menu"
          ref={(button) => {
            if (button) deleteActionButtonsRef.current.set(item.id, button);
            else deleteActionButtonsRef.current.delete(item.id);
          }}
          aria-label={`Actions for ${item.title}`}
          onFocus={(event) => {
            previewReturnFocusRef.current = event.currentTarget;
          }}
          onPointerDown={(event) => {
            previewReturnFocusRef.current = event.currentTarget;
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          // The confirmation owns focus; the closing menu must not reclaim it.
          const deleteHandoff = deleteMenuHandoffRef.current.delete(item.id);
          const versionHandoff = versionMenuHandoffRef.current.delete(item.id);
          const renameHandoff = renameMenuHandoffRef.current.delete(item.id);
          if (deleteHandoff || versionHandoff || renameHandoff) event.preventDefault();
        }}
        className="w-64"
      >
        <DropdownMenuItem onClick={() => openItemPreview(item)}>
          <Eye className="h-4 w-4" /> Preview
        </DropdownMenuItem>
        {isSignedIn && userKey && principal && libraryItemDetailPath(item) ? (
          <DropdownMenuItem
            onSelect={() => {
              const origin = {
                item,
                owner: userKey,
                principal,
                generation: lifecycleGenerationRef.current,
                url: window.location.href,
              };
              renameOriginRef.current = origin;
              renameMenuHandoffRef.current.add(item.id);
              setRenameTarget(origin);
            }}
          >
            <Pencil aria-hidden="true" /> Rename saved title
          </DropdownMenuItem>
        ) : null}
        {isSignedIn && libraryItemDetailPath(item) ? (
          <DropdownMenuItem onClick={() => void copyItemLink(item)}>
            <LinkIcon className="h-4 w-4" /> Copy link
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => void withItem(item, reuseInChat)}>
          <MessageSquarePlus className="h-4 w-4" /> Reuse in chat
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void withItem(item, (value) => openInWork(toHandoff(value), userKey))}
        >
          Open in Work
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void withItem(item, (value) => continueInChat(toHandoff(value), userKey))}
        >
          Ask Kova
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void withItem(item, (value) => addToContextPack(toHandoff(value), userKey))
          }
        >
          Add to Context Pack
        </DropdownMenuItem>
        {item.content_generation &&
          !item.work_output &&
          (item.original_generation || (!item.file_url && !isImageItem(item))) && (
            <DropdownMenuItem
              onClick={(event) => {
                if (!principalReady || !principal || libraryCleared) return;
                const origin = {
                  trigger: deleteActionButtonsRef.current.get(item.id) ?? null,
                  menuItem: event.currentTarget,
                  url: window.location.href,
                  principal,
                  generation: lifecycleGenerationRef.current,
                };
                versionMenuHandoffRef.current.add(item.id);
                let opened = false;
                void withItem(item, (value) => {
                  opened = true;
                  versionReturnFocusRef.current = origin;
                  setVersionItem(value);
                }).finally(() => {
                  if (opened) return;
                  const active = document.activeElement;
                  const current =
                    origin.principal === principalRef.current &&
                    origin.generation === lifecycleGenerationRef.current;
                  const focusMoved =
                    active !== null &&
                    active !== document.body &&
                    active !== origin.trigger &&
                    active !== origin.menuItem;
                  // An immediate failed read may precede the menu's close animation.
                  // Let that menu restore its own trigger if it still owns focus.
                  if (current && !focusMoved) versionMenuHandoffRef.current.delete(item.id);
                  const trigger = origin.trigger;
                  const canReturn =
                    trigger?.isConnected &&
                    trigger.getClientRects().length > 0 &&
                    !trigger.closest('[inert], [aria-hidden="true"]') &&
                    !trigger.matches(":disabled");
                  restoreDialogFocus(
                    canReturn ? trigger : (librarySearchRef.current ?? libraryRootRef.current),
                    origin.url,
                    !current || focusMoved,
                  );
                });
              }}
            >
              Versions and replacement
            </DropdownMenuItem>
          )}
        {item.original_generation && principal ? (
          <DropdownMenuItem
            onClick={() => {
              const owner = userKey,
                generation = lifecycleGenerationRef.current;
              const controller = new AbortController();
              pageRequests.current.add(controller);
              void import("@/lib/library-original-client")
                .then(async ({ readOriginalLibraryFile }) => {
                  if (
                    controller.signal.aborted ||
                    generation !== lifecycleGenerationRef.current ||
                    ownerIdRef.current !== owner
                  )
                    return;
                  if (!owner) return;
                  const blob = await readOriginalLibraryFile(
                    owner,
                    item.id,
                    item.original_generation!,
                    controller.signal,
                  );
                  if (
                    controller.signal.aborted ||
                    generation !== lifecycleGenerationRef.current ||
                    ownerIdRef.current !== owner
                  )
                    return;
                  const url = URL.createObjectURL(blob),
                    anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = item.file_name ?? item.title;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
                .catch(() => {
                  if (
                    !controller.signal.aborted &&
                    generation === lifecycleGenerationRef.current &&
                    ownerIdRef.current === owner
                  )
                    toast.error("The original file could not be downloaded. Please retry.");
                })
                .finally(() => pageRequests.current.delete(controller));
            }}
          >
            <Download className="h-4 w-4" /> Download original
          </DropdownMenuItem>
        ) : item.work_output === true ? (
          <WorkOutputDownloadAction id={item.id} />
        ) : isImageItem(item) ? (
          <LibraryImageDownloadAction item={item} />
        ) : safeNavigationUrl(item.file_url) ? (
          <DropdownMenuItem asChild>
            <a href={safeNavigationUrl(item.file_url)!} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" /> Open or download
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => toggleFavorite(item.id)}>
          <Star className="h-4 w-4" /> {visibleFavorites.has(item.id) ? "Unfavorite" : "Favorite"}
        </DropdownMenuItem>
        {!item.id.startsWith("workspace:") ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={folderBusy || bulkDeleteBusy}
              onClick={() => remove(item.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" /> Delete
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
    const typeLabel = item.id.startsWith("chat:")
      ? "Chat"
      : item.id.startsWith("work:")
        ? "Work"
        : item.item_type.replace(/_/g, " ");
    const metadata = libraryListMetadata(item);
    const dateLabel = new Date(metadata.savedAt).toLocaleDateString();
    const modifiedLabel = metadata.modifiedAt
      ? `Modified ${formatDisplayDateTime(metadata.modifiedAt, timeFormat)}`
      : null;
    const selectedItem = selected.includes(item.id);
    const openPreview = (event: MouseEvent<HTMLButtonElement>) => {
      previewReturnFocusRef.current = event.currentTarget;
      openItemPreview(item);
    };
    const selection = !workspaceReference ? (
      <label className="kova-library-select kova-file-selection">
        <span className="sr-only">Select {item.title}</span>
        <input
          data-ui-reference="chatgpt.checkbox"
          type="checkbox"
          checked={selectedItem}
          onChange={() =>
            setSelected((current) =>
              current.includes(item.id)
                ? current.filter((id) => id !== item.id)
                : [...current, item.id],
            )
          }
          className="kova-native-check"
        />
      </label>
    ) : null;

    if (view === "list") {
      return (
        <li
          key={item.id}
          className="kova-row kova-file-row"
          data-library-item={item.item_type}
          data-selected={selectedItem}
          data-ui-reference="chatgpt.library.file-row"
        >
          <span
            className="kova-file-type-icon"
            data-kind={image ? "image" : "document"}
            aria-hidden="true"
          >
            {image ? <ImageIcon aria-hidden="true" /> : <FileText aria-hidden="true" />}
          </span>
          <div className="kova-file-row-name">
            <button
              type="button"
              title={item.title}
              onClick={openPreview}
              data-kova-button-shape="preserve"
            >
              <span className="spec400-library-row-title">{item.title}</span>
              {metadata.filename !== item.title ? (
                <span className="kova-file-row-type" title={metadata.filename}>
                  File: {metadata.filename}
                </span>
              ) : null}
              <span className="kova-file-row-type">
                {typeLabel}
                {size ? ` · ${size}` : ""}
                {" · "}
                <time dateTime={metadata.savedAt}>Saved {dateLabel}</time>
                {modifiedLabel ? <span title={modifiedLabel}> · {modifiedLabel}</span> : null}
              </span>
            </button>
          </div>
          {selection ?? <span className="kova-file-selection-spacer" aria-hidden="true" />}
          <span className="kova-file-favorite">
            {visibleFavorites.has(item.id) ? (
              <Star className="h-4 w-4 fill-current text-amber-500" aria-label="Favorite" />
            ) : null}
          </span>
          {renderActions(item)}
        </li>
      );
    }

    return (
      <li
        key={item.id}
        className="group kova-card kova-file-card"
        data-library-item={item.item_type}
        data-selected={selectedItem}
        data-ui-reference="chatgpt.library.file-card"
      >
        <button
          type="button"
          title={item.title}
          className="kova-file-open"
          onClick={openPreview}
          data-kova-button-shape="preserve"
        >
          <span className="kova-file-preview" aria-hidden="true">
            {image ? (
              <LibraryImageMedia item={item} className="h-full w-full object-cover" />
            ) : (
              <FileText className="h-8 w-8" />
            )}
          </span>
          <span className="kova-file-title-line">
            <span
              className="kova-file-type-icon"
              data-kind={image ? "image" : "document"}
              aria-hidden="true"
            >
              {image ? <ImageIcon /> : <FileText />}
            </span>
            <span className="kova-file-title">{item.title}</span>
          </span>
        </button>
        <div className="kova-file-card-footer">
          {selection}
          <div className="kova-file-metadata">
            <span className="kova-file-kind">
              {typeLabel}
              {size ? ` · ${size}` : ""}
            </span>
            <time dateTime={metadata.savedAt}>Saved {dateLabel}</time>
            {modifiedLabel ? <span title={modifiedLabel}> · {modifiedLabel}</span> : null}
          </div>
          {visibleFavorites.has(item.id) ? (
            <Star className="h-4 w-4 shrink-0 fill-current text-amber-500" aria-label="Favorite" />
          ) : null}
          {renderActions(item)}
        </div>
      </li>
    );
  };

  const libraryRenderGeneration = lifecycleGenerationRef.current;

  return (
    <AppShell utilitiesInHeader hideUtilities>
      <main
        id="main-content"
        ref={libraryRootRef}
        tabIndex={-1}
        className="kova-page kova-secondary-page kova-core-page kova-directory kova-file-directory kova-library-page spec400-management spec400-library"
        aria-labelledby="library-title"
        data-ui-reference="chatgpt.library"
      >
        <WorkspacePageHeader
          title="Library"
          titleId="library-title"
          description="Your uploaded files and saved creations."
          actions={
            principalReady ? (
              <>
                {isSignedIn && (
                  <Button className="spec400-library-upload" onClick={() => setUploadOpen(true)}>
                    <Upload aria-hidden="true" />
                    <span>Upload</span>
                  </Button>
                )}
              </>
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
              <Button size="sm" className="shrink-0">
                Sign in
              </Button>
            </SignInButton>
          </section>
        ) : null}

        <div
          className="kova-library-utilities spec400-library-secondary"
          aria-label="Library utilities"
        >
          {isSignedIn && isLoaded ? (
            <>
              <details className="kova-library-disclosure" aria-labelledby="shared-chats-title">
                <summary className="cursor-pointer">
                  <span id="shared-chats-title">Shared chats</span>
                </summary>
                {sharesError ? (
                  <div role="alert" className="rounded-xl border border-destructive/30 p-4">
                    <p className="text-sm font-medium text-destructive">
                      Could not load shared chats
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{sharesError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
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
                                className="shrink-0"
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
                                  className="shrink-0"
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
              </details>

              {principal ? (
                <details
                  ref={foldersDetailsRef}
                  className="kova-library-disclosure"
                  key={`folders:${principal}`}
                >
                  <summary>Folders{folderScope !== "all" ? " · Filter active" : ""}</summary>
                  <LibraryFolderOrganizer
                    key={principal}
                    enabled={!libraryCleared}
                    principalKey={principal}
                    ownerId={userKey!}
                    refreshKey={folderRefreshKey}
                    itemStateUnavailable={loading || Boolean(loadError)}
                    scope={folderScope}
                    selectedItemIds={selectedDurableIds}
                    onScopeChange={setFolderScope}
                    onBusyChange={setFolderBusy}
                    onRefresh={refreshLibrary}
                    onMoved={(itemIds, folderId) => {
                      if (
                        principalRef.current !== principal ||
                        libraryRenderGeneration !== lifecycleGenerationRef.current ||
                        libraryCleared
                      )
                        return;
                      loadGenerationRef.current += 1;
                      setLoading(false);
                      const moved = new Set(itemIds);
                      setItems((current) =>
                        libraryRenderGeneration === lifecycleGenerationRef.current
                          ? current.map((item) =>
                              moved.has(item.id) ? { ...item, folder_id: folderId } : item,
                            )
                          : current,
                      );
                      setSelected((current) =>
                        principalRef.current === principal &&
                        libraryRenderGeneration === lifecycleGenerationRef.current &&
                        !libraryCleared
                          ? current.filter((id) => !moved.has(id))
                          : current,
                      );
                    }}
                    onFoldersDeleted={() => {
                      setSelected([]);
                      void load();
                    }}
                  />
                </details>
              ) : null}
            </>
          ) : null}

          {principalReady ? (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              ref={trashTriggerRef}
              onClick={() => {
                const origin = {
                  principal,
                  generation: lifecycleGenerationRef.current,
                  url: window.location.href,
                };
                trashOriginRef.current = origin;
                setTrashOwner(origin);
              }}
            >
              <Trash2 aria-hidden="true" /> Chat Trash
            </Button>
          ) : null}

          <details
            className="kova-library-disclosure spec400-library-availability"
            open={storageDetailsOpen}
            onToggle={(event) => setStorageDetailsOpen(event.currentTarget.open)}
          >
            <summary aria-label="Library details and availability">Details</summary>
            {storageTotal !== null && <p>Loaded file sizes: {humanBytes(storageTotal)}</p>}
            <p>Loaded file sizes cover this list only and are not account storage usage.</p>
            {storageDetailsOpen && !libraryCleared ? (
              <section className="my-4 max-w-2xl" aria-label="Account cloud storage">
                <h3 className="mb-2 text-sm font-medium text-foreground">Account cloud storage</h3>
                <p>
                  Measured account usage includes Library files and other stored account content.
                </p>
                <Suspense fallback={<p role="status">Loading storage usage…</p>}>
                  <StorageDashboard
                    key={`${principal}:${folderRefreshKey}`}
                    signedIn={Boolean(isSignedIn)}
                  />
                </Suspense>
              </section>
            ) : null}
            <p>
              List dates show when items were saved. File details show last-modified dates when
              recorded. Last-modified sorting, project references, and processing status are not
              available here. Source and date filters apply to loaded items; load more to include
              older results.
            </p>
            <p>
              Original shows a supported saved file preview. Extracted text shows readable text
              saved from the document and may omit formatting or unreadable pages. An original
              download preserves the stored file; a generated export is a separate file.
            </p>
            <p>
              File Trash and moving files to projects are not supported here. Rename saved title
              changes only the Library title, not its original filename. Chats use your configured
              Trash retention; files and other saved items use the permanent-delete confirmation.
              Use Folders to organize saved files.
            </p>
          </details>
          {principalReady ? (
            <Button
              size="sm"
              variant="outline"
              className="kova-directory-refresh"
              aria-label="Refresh Library"
              title="Refresh Library"
              onClick={() => {
                refreshLibrary();
                void loadShares();
              }}
              disabled={loading || folderBusy || sharesLoading}
            >
              <RefreshCw
                aria-hidden="true"
                className={`mr-1.5 h-3.5 w-3.5 ${loading || sharesLoading ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
              <span>Refresh</span>
            </Button>
          ) : null}
        </div>
        {uploadOpen && userKey && (
          <LibraryUploadDialog
            key={userKey}
            ownerId={userKey}
            onClose={() => setUploadOpen(false)}
            onSaved={() => {
              refreshLibrary();
            }}
          />
        )}
        {(isSignedIn || items.length > 0) && !loadError ? (
          <>
            <section className="kova-toolbar kova-file-toolbar" aria-label="Library toolbar">
              <label className="kova-directory-search kova-directory-search-with-icon relative min-w-0 flex-1">
                <span className="sr-only">Search Library</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={librarySearchRef}
                  value={query}
                  maxLength={200}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Library"
                  className="h-11 rounded-[var(--kova-radius-input)] pl-9"
                />
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="spec400-library-filter-trigger">
                    <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                    Filters
                    {(sourceFilter !== "all" || dateFilter !== "all") && (
                      <span aria-label="Active metadata filters">
                        {Number(sourceFilter !== "all") + Number(dateFilter !== "all")}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="spec400-library-filter-panel"
                  aria-label="Filter Library items"
                >
                  <p className="font-medium">Filter loaded items</p>
                  <div className="spec400-library-metadata-filters">
                    <div className="spec400-library-metadata-field">
                      <label htmlFor="library-source-filter">Source</label>
                      <Select value={sourceFilter} onValueChange={setSourceFilter}>
                        <SelectTrigger id="library-source-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All sources</SelectItem>
                          <SelectItem value="upload">Uploads</SelectItem>
                          <SelectItem value="chat">Chat</SelectItem>
                          <SelectItem value="images">Images</SelectItem>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="spec400-library-metadata-field">
                      <label htmlFor="library-date-filter">Date saved</label>
                      <Select value={dateFilter} onValueChange={setDateFilter}>
                        <SelectTrigger id="library-date-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any time</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <p className="spec400-supporting">
                    Source and date filters apply to loaded items. Load more to include older
                    results.
                  </p>
                </PopoverContent>
              </Popover>
              <div className="spec400-library-display-controls">
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 rounded-full"
                  aria-label="Show favorites"
                  aria-pressed={filter === "favorites"}
                  onClick={() => setFilter(filter === "favorites" ? "all" : "favorites")}
                >
                  <Star className={`h-4 w-4 ${filter === "favorites" ? "fill-current" : ""}`} />
                </Button>
                <Select value={sort} onValueChange={(value) => setSort(value as SortId)}>
                  <SelectTrigger className="kova-library-sort min-h-11" aria-label="Sort Library">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Date saved, newest first</SelectItem>
                    <SelectItem value="oldest">Date saved, oldest first</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="size">Size</SelectItem>
                  </SelectContent>
                </Select>
                <div className="kova-file-view-toggle" role="group" aria-label="Library view">
                  <button
                    data-ui-reference="chatgpt.library.view-switch"
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
              </div>
            </section>

            {(filter !== "all" || sourceFilter !== "all" || dateFilter !== "all" || query) && (
              <div className="spec400-filter-chips" aria-label="Active filters">
                {filter !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    onClick={() => setFilter("all")}
                  >
                    <span className="truncate">Type: {filter}</span>
                    <X aria-hidden="true" />
                  </Button>
                )}
                {sourceFilter !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    onClick={() => setSourceFilter("all")}
                  >
                    <span className="truncate">Source: {sourceFilter}</span>
                    <X aria-hidden="true" />
                  </Button>
                )}
                {dateFilter !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    onClick={() => setDateFilter("all")}
                  >
                    <span className="truncate">Last {dateFilter} days</span>
                    <X aria-hidden="true" />
                  </Button>
                )}
                {query && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    onClick={() => setQuery("")}
                  >
                    <span className="truncate">Search: {query}</span>
                    <X aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="max-w-full"
                  onClick={() => {
                    setFilter("all");
                    setSourceFilter("all");
                    setDateFilter("all");
                    setQuery("");
                    setFolderScope("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
            <div className="kova-file-filters" role="group" aria-label="Library filters">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition ${filter === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {selected.length && !loadError ? (
          <section
            className="kova-file-selection-bar flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3"
            aria-label="Selected Library actions"
          >
            <span className="text-sm font-medium">
              {selected.length} selected from loaded items. This does not select the entire Library.
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"

                onClick={() => setSelected([])}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"

                disabled={!principal || selectedDurableIds.length === 0 || folderBusy || loading}
                onClick={() => {
                  const details = foldersDetailsRef.current;
                  if (!details || !principalReady || !selectedDurableIds.length) return;
                  details.open = true;
                  const picker = details.querySelector<HTMLElement>(
                    '[aria-label="Move selected Library items to folder"]',
                  );
                  const target =
                    picker && !picker.matches(":disabled")
                      ? picker
                      : details.querySelector<HTMLElement>("summary");
                  target?.focus({ preventScroll: true });
                  target?.scrollIntoView({ block: "nearest" });
                }}
              >
                Move to folder
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"

                disabled={!principalReady || folderBusy || bulkDeleteBusy || loading}
                onClick={(event) => {
                  if (!principal || !principalReady || libraryCleared || !selected.length) return;
                  const origin = {
                    snapshot: selectedLibraryDownloadSnapshot(selected, items, userKey),
                    trigger: event.currentTarget,
                    owner: userKey,
                    principal,
                    generation: lifecycleGenerationRef.current,
                    url: window.location.href,
                  };
                  downloadOriginRef.current = origin;
                  setDownloadTarget(origin);
                }}
              >
                <Download className="h-5 w-5" aria-hidden="true" /> Download
              </Button>
              <Button
                size="sm"
                variant="outline"

                onClick={() => {
                  if (!favoritesReady || !favoritesKey) return;
                  const next = new Set(visibleFavorites);
                  selected.forEach((id) => next.add(id));
                  if (next.size > 1000) {
                    toast.error("Library supports up to 1,000 favorites.");
                    return;
                  }
                  setFavorites(next);
                  writeFavorites(favoritesKey, next);
                }}
              >
                Favorite
              </Button>
              <Button
                size="sm"
                variant="outline"

                onClick={() =>
                  void (async () => {
                    const owner = userKey,
                      version = lifecycleGenerationRef.current;
                    if (!principal) return;
                    if (selected.length > 20) {
                      toast.error("Choose up to 20 items for one Context Pack action.");
                      return;
                    }
                    const controller = new AbortController();
                    pageRequests.current.add(controller);
                    try {
                      const { readLibraryItem } = await import("@/lib/library-items-client");
                      const loaded = [];
                      for (const item of items.filter((item) => selected.includes(item.id))) {
                        controller.signal.throwIfAborted();
                        loaded.push(
                          item.content_loaded === false
                            ? await readLibraryItem(owner!, item, controller.signal)
                            : item,
                        );
                      }
                      if (
                        owner === ownerIdRef.current &&
                        version === lifecycleGenerationRef.current &&
                        !controller.signal.aborted
                      )
                        addManyToContextPack(loaded.map(toHandoff), userKey);
                    } catch {
                      if (
                        owner === ownerIdRef.current &&
                        version === lifecycleGenerationRef.current &&
                        !controller.signal.aborted
                      )
                        toast.error(
                          "The selected items could not be loaded. Refresh Library and try again.",
                        );
                    } finally {
                      pageRequests.current.delete(controller);
                    }
                  })()
                }
              >
                Add to Context Pack
              </Button>
              <Button
                size="sm"
                variant="destructive"

                disabled={folderBusy || bulkDeleteBusy}
                onClick={(event) => void deleteSelected(false, selected, event.currentTarget)}
              >
                {bulkDeleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </section>
        ) : null}

        {libraryCleared ? (
          <p role="status">Saved browser data was cleared. Reload this page to reopen Library.</p>
        ) : loadError ? (
          <section className="kova-empty-state" role="alert">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 font-medium">Could not load Library</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your saved items are temporarily unavailable. Try again in a moment.
            </p>
            <Button
              ref={retryButtonRef}
              className="mt-4"
              onClick={(event) => {
                if (folderBusy) return;
                const trigger = event.currentTarget;
                refreshLibrary();
                retryReturnRef.current = {
                  trigger,
                  url: window.location.href,
                  principal,
                  generation: loadGenerationRef.current,
                };
              }}
              disabled={folderBusy}
            >
              Retry
            </Button>
          </section>
        ) : loading && items.length === 0 ? (
          <section role="status" aria-labelledby="library-loading-title">
            <h2 id="library-loading-title" className="sr-only">
              Loading Library
            </h2>
            <ul
              className={
                view === "list" ? "kova-list kova-file-loading-list" : "kova-grid kova-file-grid"
              }
              aria-hidden="true"
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <li
                  key={index}
                  className="kova-file-loading-item animate-pulse rounded-lg bg-[var(--skeleton-base)] motion-reduce:animate-none"
                />
              ))}
            </ul>
          </section>
        ) : filtered.length === 0 ? (
          <section className="kova-empty-state" aria-labelledby="library-empty-title">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 id="library-empty-title" className="mt-3 font-medium">
              {query
                ? "No matches"
                : items.length === 0
                  ? isSignedIn
                    ? "Your Library is empty"
                    : "Nothing saved in this browser"
                  : query
                    ? "No matches"
                    : folderScope !== "all" && folderItems.length === 0
                      ? "This folder is empty"
                      : "No items match this filter"}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {query
                ? `Nothing matches “${query}”.`
                : items.length === 0
                  ? "Saved uploads and generated files outside Temporary Chat appear here automatically."
                  : query
                    ? `Nothing matches “${query}”.`
                    : folderScope !== "all" && folderItems.length === 0
                      ? "Move selected durable items here from All items or another folder."
                      : "Try a different file-type filter."}
            </p>
            {query || filter !== "all" || folderScope !== "all" ? (
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                  setFolderScope("all");
                }}
              >
                Show all items
              </Button>
            ) : null}
          </section>
        ) : (
          <section className="kova-file-collection" aria-labelledby="library-collection-title">
            <div className="kova-file-section-heading">
              <h2 id="library-collection-title">
                {query ? "Search results" : filter === "favorites" ? "Favorites" : "Saved items"}
              </h2>
              <span>
                {filtered.length} {filtered.length === 1 ? "item" : "items"}
                {nextPage ? " loaded" : ""}
              </span>
            </div>
            <ul
              className={view === "list" ? "kova-list kova-file-list" : "kova-grid kova-file-grid"}
              aria-label="Library items"
            >
              {filtered.map(renderItem)}
            </ul>
          </section>
        )}
        {nextPage && !loadError && (
          <div className="grid justify-items-center gap-2 py-4">
            <p className="text-sm text-muted-foreground">
              More matching saved items are available. File sizes shown cover loaded items.
            </p>
            <Button disabled={loading || folderBusy} onClick={() => void load(true)}>
              {loading ? "Loading…" : "Load more saved items"}
            </Button>
          </div>
        )}
        {versionItem && principal && userKey && principalReady && (
          <Suspense fallback={<p role="status">Loading version history…</p>}>
            <LibraryVersionsDialog
              key={`${principal}:${versionItem.id}:${versionItem.content_generation}:${versionItem.content_revision}`}
              ownerId={userKey!}
              item={versionItem}
              onClose={() => setVersionItem(null)}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const origin = versionReturnFocusRef.current;
                versionReturnFocusRef.current = null;
                const active = document.activeElement;
                const focusMoved =
                  active !== null &&
                  active !== document.body &&
                  active !== origin?.trigger &&
                  !(event.target instanceof HTMLElement && event.target.contains(active));
                const trigger = origin?.trigger;
                const canReturn =
                  trigger?.isConnected &&
                  trigger.getClientRects().length > 0 &&
                  !trigger.closest('[inert], [aria-hidden="true"]') &&
                  !trigger.matches(":disabled");
                restoreDialogFocus(
                  canReturn ? trigger : (librarySearchRef.current ?? libraryRootRef.current),
                  origin?.url,
                  focusMoved ||
                    libraryCleared ||
                    origin?.principal !== principalRef.current ||
                    origin?.generation !== lifecycleGenerationRef.current,
                );
              }}
              onUpdated={() => {
                setVersionItem(null);
                setPreviewItem(null);
                void load();
              }}
            />
          </Suspense>
        )}
        {downloadTarget &&
        downloadTarget.principal === principal &&
        downloadTarget.owner === userKey &&
        downloadTarget.generation === lifecycleGenerationRef.current &&
        !libraryCleared ? (
          <LibrarySelectedDownloadsDialog
            snapshot={downloadTarget.snapshot}
            owner={downloadTarget.owner}
            isCurrent={() =>
              downloadOriginRef.current === downloadTarget &&
              downloadTarget.principal === principalRef.current &&
              downloadTarget.owner === ownerIdRef.current &&
              downloadTarget.generation === lifecycleGenerationRef.current &&
              downloadTarget.url === window.location.href
            }
            onClose={() => setDownloadTarget(null)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = downloadOriginRef.current;
              if (origin !== downloadTarget) return;
              downloadOriginRef.current = null;
              const active = document.activeElement;
              const focusMoved =
                active !== null &&
                active !== document.body &&
                active !== origin?.trigger &&
                !(event.target instanceof HTMLElement && event.target.contains(active));
              restoreDialogFocus(
                origin?.trigger,
                origin?.url,
                focusMoved ||
                  libraryCleared ||
                  origin?.principal !== principalRef.current ||
                  origin?.generation !== lifecycleGenerationRef.current ||
                  origin?.owner !== ownerIdRef.current,
              );
            }}
          />
        ) : null}
        {renameTarget &&
        renameTarget.principal === principal &&
        renameTarget.owner === userKey &&
        renameTarget.generation === lifecycleGenerationRef.current ? (
          <LibraryRenameDialog
            key={`${renameTarget.owner}:${renameTarget.item.id}:${renameTarget.item.content_generation}`}
            item={renameTarget.item}
            owner={renameTarget.owner}
            isCurrent={() =>
              renameOriginRef.current === renameTarget &&
              renameTarget.principal === principalRef.current &&
              renameTarget.owner === ownerIdRef.current &&
              renameTarget.generation === lifecycleGenerationRef.current &&
              renameTarget.url === window.location.href
            }
            onClose={() => setRenameTarget(null)}
            onSaved={(result) => {
              setItems((current) =>
                current.map((item) =>
                  item.id === result.id && item.content_generation === result.content_generation
                    ? { ...item, title: result.title, updated_at: result.updated_at }
                    : item,
                ),
              );
              setRenameTarget(null);
              toast.success("Saved-item title updated");
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = renameOriginRef.current;
              restoreDialogFocus(
                origin ? deleteActionButtonsRef.current.get(origin.item.id) : null,
                origin?.url,
                origin?.principal !== principalRef.current ||
                  origin?.generation !== lifecycleGenerationRef.current ||
                  origin?.owner !== ownerIdRef.current,
              );
            }}
          />
        ) : null}
        <Dialog
          open={Boolean(
            trashOwner &&
            trashOwner.principal === principal &&
            trashOwner.generation === lifecycleGenerationRef.current,
          )}
          onOpenChange={(open) => {
            if (!open) {
              const origin = trashOriginRef.current;
              if (
                origin?.principal === principalRef.current &&
                origin?.generation === lifecycleGenerationRef.current
              ) {
                const chats = savedChatLibraryItems(userKey);
                setItems((current) => [
                  ...current.filter((item) => !item.id.startsWith("chat:")),
                  ...chats,
                ]);
              }
              setTrashOwner(null);
            }
          }}
        >
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = trashOriginRef.current;
              restoreDialogFocus(
                trashTriggerRef.current,
                origin?.url,
                !principalReady ||
                  origin?.principal !== principalRef.current ||
                  origin?.generation !== lifecycleGenerationRef.current,
              );
            }}
          >
            <DialogTitle>Chat Trash</DialogTitle>
            <DialogDescription>
              Recover deleted chats saved in this browser. Library files are not kept here.
            </DialogDescription>
            {trashOwner?.principal === principal ? (
              <ChatTrashPanel key={principal ?? "guest"} userKey={userKey} />
            ) : null}
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(detailKey || visiblePreviewItem)}
          onOpenChange={(open) => {
            if (!open) closeItemPreview();
          }}
        >
          {detailKey || visiblePreviewItem ? (
            <DialogContent
              className="spec400-library-inspector"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = previewReturnFocusRef.current;
                const origin = previewOriginRef.current;
                restoreDialogFocus(
                  trigger?.isConnected
                    ? trigger
                    : (librarySearchRef.current ?? libraryRootRef.current),
                  origin?.url ?? new URL("/library", window.location.origin).href,
                  Boolean(detailKeyRef.current) ||
                    libraryCleared ||
                    (origin !== null && origin.principal !== principalRef.current),
                );
                previewReturnFocusRef.current = null;
                previewOriginRef.current = null;
                detailHistoryRef.current = null;
              }}
            >
              {visiblePreviewItem ? (
                <>
                  <header className="spec400-library-inspector-header shrink-0 border-b border-border">
                    <div className="spec400-library-inspector-title">
                      <div className="min-w-0 flex-1">
                        <DialogTitle className="truncate text-base">
                          {visiblePreviewItem.title}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                          {visiblePreviewItem.item_type.replace(/_/g, " ")} ·{" "}
                          {new Date(visiblePreviewItem.created_at).toLocaleDateString()}
                        </DialogDescription>
                      </div>
                    </div>
                    <div className="spec400-library-inspector-actions">
                      {detailKey ? (
                        <Button
                          size="sm"
                          variant="outline"

                          onClick={() => void copyItemLink(visiblePreviewItem)}
                        >
                          <LinkIcon aria-hidden="true" className="h-4 w-4" /> Copy link
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"

                        onClick={() => reuseInChat(visiblePreviewItem)}
                      >
                        Reuse in chat
                      </Button>
                    </div>
                  </header>
                  <div className="spec400-inspector-body">
                    <nav
                      aria-label="Breadcrumb"
                      className="spec400-supporting flex flex-wrap items-center gap-2"
                    >
                      <a
                        href="/library"
                        className="inline-flex min-h-11 items-center underline"
                        onClick={(event) => {
                          if (
                            event.button !== 0 ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          closeItemPreview();
                        }}
                      >
                        Library
                      </a>
                      <span aria-hidden="true">/</span>
                      <span aria-current="page">{visiblePreviewItem.title}</span>
                    </nav>
                    {detailKey ? (
                      <p className="spec400-supporting">
                        This link opens the current saved version of this item. Sign-in and access
                        are required; copying the link does not grant access.
                      </p>
                    ) : null}
                    <dl className="spec400-file-details">
                      <dt>Saved title</dt>
                      <dd>{visiblePreviewItem.title}</dd>
                      <dt>Original filename</dt>
                      <dd>{visiblePreviewItem.file_name?.trim() || "Not recorded"}</dd>
                      <dt>Type</dt>
                      <dd>
                        {visiblePreviewItem.file_type ||
                          visiblePreviewItem.item_type.replace(/_/g, " ")}
                      </dd>
                      <dt>Stored size</dt>
                      <dd>{humanBytes(visiblePreviewItem.file_size) ?? "Not recorded"}</dd>
                      <dt>Source</dt>
                      <dd>{visiblePreviewItem.source || "Not recorded"}</dd>
                      <dt>Date saved</dt>
                      <dd>
                        {libraryModifiedAt(visiblePreviewItem.created_at)
                          ? formatDisplayDateTime(visiblePreviewItem.created_at, timeFormat)
                          : "Not recorded"}
                      </dd>
                      <dt>Last modified</dt>
                      <dd>
                        {libraryModifiedAt(visiblePreviewItem.updated_at) ? (
                          <time dateTime={visiblePreviewItem.updated_at}>
                            {formatDisplayDateTime(visiblePreviewItem.updated_at!, timeFormat)}
                          </time>
                        ) : (
                          "Not recorded for this item"
                        )}
                      </dd>
                      <dt>Projects</dt>
                      <dd>References unavailable</dd>
                    </dl>
                    <div className="spec400-inspector-tabs" role="group" aria-label="File views">
                      <button
                        aria-pressed={previewView === "preview"}
                        onClick={() => setPreviewView("preview")}
                      >
                        Original
                      </button>
                      {!isImageItem(visiblePreviewItem) && (
                        <button
                          aria-pressed={previewView === "text"}
                          onClick={() => setPreviewView("text")}
                        >
                          Extracted text
                        </button>
                      )}
                    </div>

                    {isImageItem(visiblePreviewItem) ? (
                      <LibraryImageMedia
                        item={visiblePreviewItem}
                        eager
                        className="mx-auto max-h-[65dvh] rounded-xl object-contain"
                        fallbackClassName="min-h-64 rounded-xl bg-[var(--surface-secondary)]"
                      />
                    ) : previewView === "preview" ? (
                      <LibraryDocumentPreview
                        key={`${userKey}:${visiblePreviewItem.id}:${visiblePreviewItem.original_generation ?? "none"}`}
                        item={visiblePreviewItem}
                        ownerId={isSignedIn ? userKey : null}
                        viewMemory={documentViewMemory}
                      />
                    ) : (
                      <pre className="max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm leading-relaxed">
                        {visiblePreviewItem.content_text ||
                          "No extracted text available. The Original tab can show a supported saved original; Download original is available from the item menu when an original is stored."}
                      </pre>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <header className="shrink-0 border-b border-border p-4 pr-16 sm:pl-6">
                    <DialogTitle className="text-base">Library item</DialogTitle>
                    <DialogDescription className="text-xs">
                      A private item link requires sign-in and access to the saved item.
                    </DialogDescription>
                  </header>
                  <div className="spec400-inspector-body space-y-4">
                    <p role={detail.status === "loading" ? "status" : "alert"}>
                      {detail.status === "loading"
                        ? "Loading Library item…"
                        : detail.status === "signed-out"
                          ? "Sign in to the account that owns this Library item. This link does not grant access."
                          : detail.status === "invalid"
                            ? "This Library link is invalid. Open the item from Library and copy a new link."
                            : detail.status === "unavailable"
                              ? "This Library item is unavailable. It may have been deleted, or this account may not have access to the linked item generation."
                              : detail.status === "cleared"
                                ? "Library data was cleared for this account. Reload Library to fetch saved items again."
                                : "This Library item could not be loaded. Check your connection and try again."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {detail.status === "signed-out" ? (
                        <SignInButton mode="modal">
                          <Button>Sign in</Button>
                        </SignInButton>
                      ) : null}
                      {detail.status === "error" || detail.status === "unavailable" ? (
                        <Button variant="outline" onClick={detail.retry}>
                          Try again
                        </Button>
                      ) : null}
                      <Button variant="outline" onClick={closeItemPreview}>
                        Back to Library
                      </Button>
                    </div>
                  </div>
                </>
              )}
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
              className="mx-auto gap-0 overflow-hidden p-0 sm:mx-0 sm:w-[min(92vw,768px)] sm:max-w-3xl sm:p-0 [&>div[aria-hidden]:first-child]:mt-2 [&>div[aria-hidden]:first-child]:shrink-0"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = sharedPreviewReturnFocusRef.current;
                if (trigger?.isConnected) trigger.focus();
                sharedPreviewReturnFocusRef.current = null;
              }}
            >
              <header className="shrink-0 border-b border-border p-4 pr-16 sm:pl-6">
                <DialogTitle className="truncate text-base">
                  {visibleSharedPreview.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Read-only snapshot · {visibleSharedPreview.snapshot.messages.length} messages ·{" "}
                  shared {new Date(visibleSharedPreview.created_at).toLocaleDateString()}
                </DialogDescription>
              </header>
              <ol className="min-h-0 min-w-0 max-h-[70dvh] space-y-4 overflow-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
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
          open={deleteDialogOpen && visiblePendingDelete !== null}
          onOpenChange={setDeleteDialogOpen}
          title={deleteSummary.title}
          description={deleteSummary.description}
          confirmLabel={deleteSummary.confirmLabel}
          destructive
          disabled={!visiblePendingDelete || folderBusy || bulkDeleteBusy || !principalReady}
          onConfirm={() => {
            const pending = visiblePendingDelete;
            if (!pending || folderBusy || bulkDeleteBusy || !principalReady) return;
            try {
              if (pending.retentionMs !== null) {
                const retentionMs = readChatTrash(userKey).retentionMs;
                if (retentionMs !== pending.retentionMs) {
                  toast.error("Your Trash setting changed. Open Delete again to review it.");
                  return;
                }
              }
              // Confirm only the named snapshot, never a newer selection or another account.
              if (pending.items.some((target) => !items.some((item) => item.id === target.id))) {
                toast.error(
                  "Your Library changed. Open Delete again to review the selected items.",
                );
                return;
              }
              confirmedDeleteRef.current = pending;
            } catch {
              toast.error("Your Trash setting could not be read. Nothing was deleted. Try again.");
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = deleteReturnFocusRef.current;
            let confirmed = confirmedDeleteRef.current;
            deleteReturnFocusRef.current = null;
            confirmedDeleteRef.current = null;
            setPendingDelete(null);
            const current =
              origin !== null &&
              origin.principal === principalRef.current &&
              origin.generation === lifecycleGenerationRef.current &&
              origin.url === window.location.href &&
              !libraryCleared;
            if (current && confirmed && confirmed.retentionMs !== null) {
              try {
                if (readChatTrash(userKey).retentionMs !== confirmed.retentionMs) {
                  confirmed = null;
                  toast.error("Your Trash setting changed. Open Delete again to review it.");
                }
              } catch {
                confirmed = null;
                toast.error(
                  "Your Trash setting could not be read. Nothing was deleted. Try again.",
                );
              }
            }
            const active = document.activeElement;
            const focusMoved =
              active !== document.body &&
              active !== origin?.trigger &&
              !(event.target instanceof HTMLElement && event.target.contains(active));
            const fallback = librarySearchRef.current ?? libraryRootRef.current;
            const trigger = origin?.trigger;
            const canReturn =
              trigger?.isConnected &&
              trigger.getClientRects().length > 0 &&
              !trigger.closest('[inert], [aria-hidden="true"]') &&
              !trigger.matches(":disabled");
            restoreDialogFocus(
              !confirmed && canReturn ? trigger : fallback,
              origin?.url,
              !current || focusMoved,
            );
            // Wait until this dialog has closed before the existing permanent-chat
            // confirmation can open, and focus a stable control before removing rows.
            if (!current || !confirmed) return;
            if (confirmed.kind === "one") void remove(confirmed.items[0].id, true);
            else
              void deleteSelected(
                true,
                confirmed.items.map((item) => item.id),
              );
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
