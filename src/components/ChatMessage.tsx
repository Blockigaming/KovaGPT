import { normalizeResponseFollowups } from "@/lib/response-followups.mjs";
import "./response-action-refinement.css";
import { normalizeMemorySources } from "@/lib/memory-sources.mjs";
import { ResponseMarkdown } from "./ResponseMarkdown";
import { TaskCreatedBubble } from "./TaskCreatedBubble";
import { HistoricalLibraryAttachment } from "./HistoricalLibraryAttachment";
import type { ResultDescriptor } from "./ArtifactEditor";
import { splitGenerativeContent, type GenerativeWidget } from "@/lib/generative-ui.mjs";
import { GenerativeCanvas } from "./generative-ui/GenerativeCanvas";
import {
  Copy,
  CornerDownRight,
  Check,
  ImageIcon,
  Loader2,
  Bookmark,
  Brain,
  FileEdit,
  Code2,
  MoreHorizontal,
  Share2,
  Pencil,
  RefreshCw,
  GitBranch,
  Globe,
  Mail,
  FileText,
  ThumbsUp,
  ThumbsDown,
  History,
  TextSelect,
  GraduationCap,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { ResponseSpeechButton } from "./ResponseSpeechButton";
import { useLayout } from "@/hooks/use-mobile";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { formatDisplayDateTime } from "@/lib/time-format";
import { normalizeSourceRetrievedAt } from "@/lib/response-source-time.mjs";
import type { Message } from "@/lib/chat-store";
import { extractCharts } from "./chat-chart-utils";
import { extractEmailFromMessage, openEmailCompose } from "./message-action-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { saveToLibrary } from "@/lib/library.functions";
import { getResponseFeedbackBatch, submitResponseFeedback } from "@/lib/feedback.functions";
import { loadResponseFeedbackBatched } from "@/lib/feedback-batch";
import { useUser } from "@/components/auth/ClerkSafe";
import { detectArtifactKind, extractCodeBlocks } from "./artifact-utils";
import { ToolConfirmCard } from "./ToolConfirmCard";
import type { PendingConfirm } from "@/lib/chat-store";
import { InfoChip } from "./InfoChip";
import { detectInfoChip } from "./info-chip-utils";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

const MemorySourcesDialog = lazy(() =>
  import("./MemorySourcesDialog").then(({ MemorySourcesDialog }) => ({
    default: MemorySourcesDialog,
  })),
);
const ChatChart = lazy(() =>
  import("./ChatChart").then(({ ChatChart }) => ({ default: ChatChart })),
);
const ArtifactEditor = lazy(() =>
  import("./ArtifactEditor").then(({ ArtifactEditor }) => ({ default: ArtifactEditor })),
);
const SelectionEditDialog = lazy(() =>
  import("./SelectionEditDialog").then(({ SelectionEditDialog }) => ({
    default: SelectionEditDialog,
  })),
);
const ChatStudyControl = lazy(() =>
  import("./ChatStudyControl").then(({ ChatStudyControl }) => ({ default: ChatStudyControl })),
);
const MessageVersionHistoryDialog = lazy(() =>
  import("./MessageVersionHistoryDialog").then(({ MessageVersionHistoryDialog }) => ({
    default: MessageVersionHistoryDialog,
  })),
);

// Preserve the model's markdown exactly enough for source links, citation
// markers, lists, and typography to survive rendering. ReactMarkdown handles
// escaping; this normalization only makes streamed Windows line endings
// deterministic.
function cleanAssistantText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const CONTINUED_WAIT_MS = 8_000;
const EXTENDED_WAIT_MS = 30_000;

type WaitStage = "initial" | "continued" | "extended";

function waitStageAt(startedAt: number): WaitStage {
  const elapsed = Math.max(0, Date.now() - startedAt);
  if (elapsed >= EXTENDED_WAIT_MS) return "extended";
  if (elapsed >= CONTINUED_WAIT_MS) return "continued";
  return "initial";
}

function StreamingStatus({
  activities,
  startedAt,
}: {
  activities?: import("@/lib/chat-store").Activity[];
  startedAt: number;
}) {
  const [waitStage, setWaitStage] = useState<WaitStage>(() => waitStageAt(startedAt));
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);
  useEffect(() => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    setWaitStage(waitStageAt(startedAt));
    const continuedTimer =
      elapsed < CONTINUED_WAIT_MS
        ? window.setTimeout(() => setWaitStage("continued"), CONTINUED_WAIT_MS - elapsed)
        : null;
    const extendedTimer =
      elapsed < EXTENDED_WAIT_MS
        ? window.setTimeout(() => setWaitStage("extended"), EXTENDED_WAIT_MS - elapsed)
        : null;
    return () => {
      if (continuedTimer !== null) window.clearTimeout(continuedTimer);
      if (extendedTimer !== null) window.clearTimeout(extendedTimer);
    };
  }, [startedAt]);

  const active =
    activities
      ?.slice()
      .reverse()
      .find((activity) => activity.status === "running") ?? null;
  const tool = (active?.tool ?? "").toLowerCase();
  let label =
    waitStage === "extended"
      ? "Taking a little longer"
      : waitStage === "continued"
        ? "Still waiting for the response"
        : "Preparing reply";
  if (tool) {
    if (tool.includes("image")) label = "Creating Image";
    else if (tool.includes("gmail") || tool.includes("mail")) label = "Checking Gmail";
    else if (tool.includes("calendar")) label = "Checking Calendar";
    else if (tool.includes("drive") || tool.includes("file") || tool.includes("read"))
      label = "Reading documents";
    else if (tool.includes("memory") || tool.includes("recall")) label = "Searching memory";
    else if (tool.includes("search") || tool.includes("web") || tool.includes("browse"))
      label = "Searching the web";
    else if (tool.includes("write")) label = "Writing draft";
    else label = active?.label ?? "Working";
  }
  return (
    <div
      className="kova-thinking-indicator flex min-h-8 flex-wrap items-center gap-2 py-1"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-wait-stage={waitStage}
    >
      <ol
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        aria-label="Response progress"
      >
        <li className="inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Request started
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="step">{active ? "Tool in progress" : "Waiting for reply"}</li>
      </ol>
      <span key={label} className="text-sm font-medium text-muted-foreground">
        {label}…
      </span>
      {elapsedSeconds >= 8 && (
        <span role="timer" aria-live="off" className="text-xs text-muted-foreground">
          {elapsedSeconds}s elapsed
        </span>
      )}
    </div>
  );
}

function ChatMessageInner({
  message,
  streaming,
  streamingStartedAt,
  onFollowUp,
  onDraftPrompt,
  onRetry,
  onBranch,
  onSaveMemory,
  onEdit,
  onUpdatePendingConfirm,
  userKey,
  principalResolved,
  chatId,
  temporary = false,
  projectId,
  onReplaceContent,
  onOpenResult,
  onOpenCanvas,
  onSelectSuggestion,
}: {
  message: Message;
  streaming?: boolean;
  /** Request start time survives chat navigation while the response remains active. */
  streamingStartedAt?: number;
  /** Executes an explicit editor improvement request. */
  onFollowUp?: (prompt: string) => void;
  /** Preserves the composer draft; invoke the returned focus handoff after dismissing a popup. */
  onDraftPrompt?: (prompt: string) => (() => void) | undefined;
  onRetry?: () => void;
  onBranch?: () => void;
  onSaveMemory?: (trigger: HTMLElement | null) => void;
  onEdit?: () => void;
  onUpdatePendingConfirm?: (messageId: string, next: PendingConfirm) => void;
  userKey: string | null;
  principalResolved: boolean;
  /** Enables durable, per-message edit history in Canvas when signed in. */
  chatId?: string | null;
  /** Temporary chats never persist edits or versions. */
  temporary?: boolean;
  projectId?: string | null;
  /** Applies an accepted selection edit / restored version to this message. */
  onReplaceContent?: (messageId: string, nextContent: string) => void;
  onOpenResult?: (
    result: ResultDescriptor & { canvasSourceKey?: string },
    trigger?: HTMLElement,
  ) => void;
  onOpenCanvas?: (widget: GenerativeWidget, trigger?: HTMLElement, sourceKey?: string) => void;
  onSelectSuggestion?: (prompt: string) => void;
}) {
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const lifecycleGenerationRef = useRef(0);
  const { isSignedIn } = useUser();
  const timeFormat = useTimeFormatPreference(userKey, principalResolved);
  const getFeedbackBatchFn = useServerFn(getResponseFeedbackBatch);
  const feedbackFn = useServerFn(submitResponseFeedback);
  useEffect(() => {
    lifecycleGenerationRef.current += 1;
  }, [principal]);
  const isUser = message.role === "user";
  const retryActionLabel = message.generationStatus ? "Retry response" : "Regenerate response";
  const [copied, setCopied] = useState(false);
  const [copyFallbackOpen, setCopyFallbackOpen] = useState(false);
  const copyFallbackRef = useRef<HTMLTextAreaElement>(null);
  const copyFallbackReturnRef = useRef<HTMLElement | null>(null);
  const rememberCopyTrigger = () => {
    copyFallbackReturnUrlRef.current = window.location.href;
    copyFallbackReturnRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const copyFallbackReturnUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => setCopyFallbackOpen(false), [principal, message.id]);
  const feedbackBaseKey = principalResolved
    ? principalScopedStorageKey("kova-message-feedback", userKey)
    : null;
  const feedbackKey =
    feedbackBaseKey && message.id ? `${feedbackBaseKey}:${encodeURIComponent(message.id)}` : null;
  const [feedbackState, setFeedbackState] = useState<{
    key: string | null;
    value: "up" | "down" | null;
  }>({ key: null, value: null });
  const feedback = feedbackState.key === feedbackKey ? feedbackState.value : null;
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackLoadFailed, setFeedbackLoadFailed] = useState(false);
  const [feedbackReload, setFeedbackReload] = useState(0);
  const localStreamingStartedAtRef = useRef<number | null>(null);
  if (!streaming) localStreamingStartedAtRef.current = null;
  else if (localStreamingStartedAtRef.current === null)
    localStreamingStartedAtRef.current = Date.now();
  const resolvedStreamingStartedAt =
    streamingStartedAt ?? localStreamingStartedAtRef.current ?? Date.now();
  const waitingForFirstToken = Boolean(streaming && !message.content && !message.pendingImage);
  const visibleActivities = waitingForFirstToken
    ? message.activities?.filter((activity) => activity.status !== "running")
    : message.activities;

  useEffect(() => {
    const requestGeneration = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      requestGeneration === lifecycleGenerationRef.current &&
      requestPrincipal === principalRef.current;

    if (isUser || !feedbackKey) {
      setFeedbackState({ key: null, value: null });
      setFeedbackSaving(false);
      setFeedbackLoadFailed(false);
      return () => {
        cancelled = true;
      };
    }

    if (!isSignedIn || !userKey) {
      let stored: string | null = null;
      try {
        stored = safeBrowserStorage("localStorage")?.getItem(feedbackKey) ?? null;
      } catch {
        /* Keep guest feedback session-only when browser storage is unavailable. */
      }
      setFeedbackState({
        key: feedbackKey,
        value: stored === "up" || stored === "down" ? stored : null,
      });
      setFeedbackSaving(false);
      setFeedbackLoadFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setFeedbackState({ key: feedbackKey, value: null });
    setFeedbackSaving(true);
    setFeedbackLoadFailed(false);
    void (async () => {
      try {
        const rating = await loadResponseFeedbackBatched(
          userKey,
          message.id,
          async (messageIds) => {
            const result = await getFeedbackBatchFn({
              data: { expectedOwnerId: userKey, messageIds },
            });
            return result.ratings;
          },
        );
        if (!isCurrent()) return;
        setFeedbackState({ key: feedbackKey, value: rating });
        try {
          const storage = safeBrowserStorage("localStorage");
          if (rating) storage?.setItem(feedbackKey, rating);
          else storage?.removeItem(feedbackKey);
        } catch {
          /* The authenticated feedback row remains authoritative. */
        }
      } catch {
        if (isCurrent()) {
          setFeedbackState({ key: feedbackKey, value: null });
          setFeedbackLoadFailed(true);
        }
      } finally {
        if (isCurrent()) setFeedbackSaving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    feedbackKey,
    feedbackReload,
    getFeedbackBatchFn,
    isSignedIn,
    isUser,
    message.id,
    principal,
    userKey,
  ]);

  const persistFeedback = async (next: "up" | "down" | null) => {
    if (!feedbackKey) {
      toast.error("Your account is still loading. Try again.");
      return;
    }
    const previous = feedback;
    const requestGeneration = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      requestGeneration === lifecycleGenerationRef.current &&
      requestPrincipal === principalRef.current;
    setFeedbackState({ key: feedbackKey, value: next });
    setFeedbackSaving(true);

    if (isSignedIn) {
      if (!userKey) {
        setFeedbackState({ key: feedbackKey, value: previous });
        setFeedbackSaving(false);
        toast.error("Your account is still loading. Try again.");
        return;
      }
      try {
        await feedbackFn({
          data: { expectedOwnerId: userKey, messageId: message.id, rating: next },
        });
        if (!isCurrent()) return;
        try {
          const storage = safeBrowserStorage("localStorage");
          if (next) storage?.setItem(feedbackKey, next);
          else storage?.removeItem(feedbackKey);
        } catch {
          /* The authenticated feedback row remains authoritative. */
        }
        toast.success(next ? "Feedback saved" : "Feedback removed");
      } catch (error) {
        if (!isCurrent()) return;
        setFeedbackState({ key: feedbackKey, value: previous });
        toast.error(error instanceof Error ? error.message : "Feedback could not be saved.");
      } finally {
        if (isCurrent()) setFeedbackSaving(false);
      }
      return;
    }

    let persisted = false;
    try {
      const storage = safeBrowserStorage("localStorage");
      if (next) storage?.setItem(feedbackKey, next);
      else storage?.removeItem(feedbackKey);
      persisted = Boolean(storage);
    } catch {
      /* The visible rating can remain session-only. */
    }
    toast.success(
      next
        ? persisted
          ? "Rating saved on this device"
          : "Rating applied for this session"
        : "Rating removed",
    );
    setFeedbackSaving(false);
  };
  const { isMobile } = useLayout();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const startLongPress = useCallback(() => {
    if (!isMobile) return;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      try {
        navigator.vibrate?.(12);
      } catch {
        /* ignore */
      }
      setMobileSheetOpen(true);
    }, 480);
  }, [isMobile]);
  const cancelLongPress = useCallback(() => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [selectionTarget, setSelectionTarget] = useState<{
    source: string;
    start: number;
    end: number;
  } | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectionInstruction, setSelectionInstruction] = useState("");
  const [selectionQuestion, setSelectionQuestion] = useState("");
  const [selectionAskOpen, setSelectionAskOpen] = useState(false);
  const [selectionAskPassage, setSelectionAskPassage] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compareVersions, setCompareVersions] = useState(false);
  const [studySession, setStudySession] = useState<{ key: string; source: string } | null>(null);
  const responseMoreRef = useRef<HTMLButtonElement | null>(null);
  const memoryReviewOpeningRef = useRef(false);
  const responseDraftFocusRef = useRef<(() => void) | null>(null);
  const studyReturnFocusRef = useRef<HTMLElement | null>(null);
  const studyReturnUrlRef = useRef<string | undefined>(undefined);
  const studyOpeningRef = useRef(false);
  const studyContextKey = JSON.stringify([principal, chatId, message.id, temporary]);
  const studyContextRef = useRef(studyContextKey);
  studyContextRef.current = studyContextKey;
  useEffect(() => {
    responseDraftFocusRef.current = null;
    setSelectionAskOpen(false);
    setSelectionQuestion("");
    setStudySession(null);
    studyReturnFocusRef.current = null;
    studyOpeningRef.current = false;
  }, [studyContextKey]);
  const openStudy = () => {
    if (!principalResolved || isUser || streaming || !message.content.trim()) return;
    studyReturnFocusRef.current = responseMoreRef.current;
    studyReturnUrlRef.current = window.location.href;
    studyOpeningRef.current = true;
    setStudySession({ key: studyContextKey, source: message.content });
  };
  const sourcesContextKey = JSON.stringify([principal, chatId, message.id, temporary]);
  const sourcesContextRef = useRef(sourcesContextKey);
  sourcesContextRef.current = sourcesContextKey;
  const [sourcesSession, setSourcesSession] = useState<{
    key: string;
    trigger: HTMLElement | null;
    openedUrl: string;
  } | null>(null);
  const sourcesReturnFocusRef = useRef<typeof sourcesSession>(null);
  const sourcesPillRef = useRef<HTMLButtonElement | null>(null);
  const sourcesOpen = sourcesSession?.key === sourcesContextKey;
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const closeSources = useCallback(() => setSourcesSession(null), []);
  useEffect(() => {
    closeSources();
    sourcesReturnFocusRef.current = null;
    return () => {
      sourcesReturnFocusRef.current = null;
    };
  }, [closeSources, sourcesContextKey]);
  const openSources = useCallback(
    (trigger: HTMLElement | null, id: string | null = null) => {
      if (!principalResolved || !message.sources?.length) return;
      const session = { key: sourcesContextKey, trigger, openedUrl: window.location.href };
      sourcesReturnFocusRef.current = session;
      setSourcesSession(session);
      setActiveSourceId(id);
    },
    [principalResolved, sourcesContextKey, message.sources?.length],
  );
  const openSource = useCallback(
    (id: string, trigger: HTMLButtonElement) => openSources(trigger, id),
    [openSources],
  );
  const [memoryOpenFor, setMemoryOpenFor] = useState<string | null>(null);
  const memorySources =
    principalResolved && !isUser
      ? normalizeMemorySources(message.memorySources, userKey, temporary)
      : undefined;
  const memoryKey = `${principal}:${message.id}`;
  const memoryReturnFocusRef = useRef<HTMLElement | null>(null);
  const memoryReturnUrlRef = useRef<string | undefined>(undefined);
  const memoryContextRef = useRef(memoryKey);
  memoryContextRef.current = memoryKey;
  const closeMemory = useCallback(() => setMemoryOpenFor(null), []);
  useEffect(() => {
    closeMemory();
    memoryReturnFocusRef.current = null;
  }, [closeMemory, principal, message.id]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastSelectionRef = useRef<string>("");
  const selectionActionsRef = useRef<HTMLDivElement>(null);
  const selectionMountedRef = useRef(false);
  useEffect(() => {
    selectionMountedRef.current = true;
    return () => {
      selectionMountedRef.current = false;
    };
  }, []);
  const selectionSourceRef = useRef({ key: studyContextKey, content: message.content });
  selectionSourceRef.current = { key: studyContextKey, content: message.content };
  useEffect(() => {
    lastSelectionRef.current = "";
    setSelectedText("");
    setSelectionOpen(false);
    setSelectionTarget(null);
    setSelectionAskOpen(false);
    setSelectionAskPassage("");
  }, [studyContextKey, message.content]);

  // Keep native selection and mobile handles intact. The toolbar sits below the response.
  const rememberSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = bodyRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !container ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !container.contains(selection.anchorNode) ||
      !container.contains(selection.focusNode)
    ) {
      // Keyboard focus on an action may collapse the native range before click.
      if (selection?.isCollapsed && selectionActionsRef.current?.contains(document.activeElement))
        return;
      lastSelectionRef.current = "";
      setSelectedText("");
      return;
    }
    const text = selection.toString();
    lastSelectionRef.current = text;
    setSelectedText(text);
  }, []);
  useEffect(() => {
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, [rememberSelection]);
  const openSelectionEdit = useCallback(
    async (instruction = "") => {
      // Snapshot the intended passage before focus or the lazy load can change selection.
      const picked = lastSelectionRef.current;
      const generation = lifecycleGenerationRef.current;
      const { locateSelection } = await import("@/lib/selection-edit.mjs");
      if (
        !selectionMountedRef.current ||
        generation !== lifecycleGenerationRef.current ||
        selectionSourceRef.current.key !== studyContextKey ||
        selectionSourceRef.current.content !== message.content
      )
        return;
      try {
        const range = locateSelection(message.content, picked);
        setSelectionTarget({ source: message.content, start: range.start, end: range.end });
        setSelectionInstruction(instruction);
        setSelectionOpen(true);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Select some text in the response first.",
        );
      }
    },
    [message.content, studyContextKey],
  );

  const saveFn = useServerFn(saveToLibrary);
  const saveImageFn = useServerFn(saveImageToLibrary);
  const imageSaveIds = useRef(new Map<string, string>());
  const saveResponseImage = async (src: string, title: string) => {
    if (!isSignedIn || !userKey)
      throw new Error(
        "Sign in to save generated images to Library. You can download this image now.",
      );
    let key = imageSaveIds.current.get(src);
    if (!key) {
      key = crypto.randomUUID();
      imageSaveIds.current.set(src, key);
    }
    await saveImageFn({
      data: {
        expectedOwnerId: userKey,
        idempotencyKey: key,
        imageUrl: src,
        title: title.slice(0, 200) || "Generated image",
      },
    });
  };

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      lifecycleGenerationRef.current += 1;
      setSaving(false);
      setSaved(false);
      setCopied(false);
      setCopyFallbackOpen(false);
      setFeedbackSaving(Boolean(isSignedIn && !isUser));
      setFeedbackLoadFailed(false);
      setFeedbackState({ key: feedbackKey, value: null });
      setFeedbackReload((current) => current + 1);
      setEditorOpen(false);
      responseDraftFocusRef.current = null;
      setSelectionAskOpen(false);
      setSelectionQuestion("");
      setSelectionAskPassage("");
      lastSelectionRef.current = "";
      setSelectedText("");
      setSelectionOpen(false);
      setSelectionTarget(null);
      setStudySession(null);
      studyReturnFocusRef.current = null;
      closeSources();
      sourcesReturnFocusRef.current = null;
      setMemoryOpenFor(null);
      memoryReturnFocusRef.current = null;
      setMobileSheetOpen(false);
      cancelLongPress();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [
    cancelLongPress,
    closeSources,
    feedbackKey,
    isSignedIn,
    isUser,
    principal,
    principalResolved,
    userKey,
  ]);

  const artifactKind = useMemo(
    () =>
      isUser || splitGenerativeContent(message.content || "").some((part) => part.kind === "widget")
        ? null
        : detectArtifactKind(message.content || ""),
    [isUser, message.content],
  );
  const editorContent = useMemo(() => {
    if (!artifactKind) return message.content;
    if (artifactKind === "writing") return message.content;
    const blocks = extractCodeBlocks(message.content);
    return blocks.length > 1
      ? blocks.map((b, i) => `// --- Block ${i + 1} ---\n${b}`).join("\n\n")
      : (blocks[0] ?? message.content);
  }, [artifactKind, message.content]);

  const openResult = (mode: "edit" | "preview" = "edit", trigger?: HTMLElement) => {
    if (isUser || streaming || !message.content.trim()) return;
    if (onOpenResult) {
      onOpenResult(
        {
          title:
            message.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.slice(0, 120) ||
            (!artifactKind || artifactKind === "writing"
              ? "Writing result"
              : artifactKind === "website"
                ? "Website result"
                : "Code result"),
          initialContent: editorContent,
          kind: artifactKind ?? "writing",
          initialMode: mode,
          chatId: temporary ? null : chatId,
          messageId: temporary ? null : message.id,
          projectId: temporary ? null : projectId,
        },
        trigger,
      );
    } else {
      setEditorMode(mode);
      setEditorOpen(true);
    }
  };

  const email = useMemo(
    () => (isUser ? null : extractEmailFromMessage(message.content || "")),
    [isUser, message.content],
  );

  const copy = async () => {
    rememberCopyTrigger();
    const generation = lifecycleGenerationRef.current;
    const requestPrincipal = principal;

    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (
        generation !== lifecycleGenerationRef.current ||
        requestPrincipal !== principalRef.current
      )
        return;
      setCopied(false);
      setCopyFallbackOpen(true);
    }
  };

  const share = async () => {
    const text = message.content;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text, title: "KovaGPT response" });
        return;
      } catch {
        /* Fall back to copying unless the browser completed a share. */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Response copied to clipboard");
    } catch {
      toast.error("Couldn't share");
    }
  };

  const saveItem = async () => {
    if (saving) return;
    // Guests can save to a local-only library while signed-in users persist through Supabase.
    const dedupKey = principalResolved
      ? principalScopedStorageKey("kovagpt-saved-message-ids", userKey)
      : null;
    if (!principal || !dedupKey) {
      toast.error("Your account is still loading. Try again.");
      return;
    }
    const requestGeneration = lifecycleGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      requestGeneration === lifecycleGenerationRef.current &&
      requestPrincipal === principalRef.current;
    let savedIds: string[];
    try {
      savedIds = JSON.parse(safeBrowserStorage("localStorage")?.getItem(dedupKey) || "[]");
    } catch {
      savedIds = [];
    }
    if (message.id && savedIds.includes(message.id)) {
      setSaved(true);
      toast.info("Already in your Library.");
      setTimeout(() => setSaved(false), 2000);
      return;
    }
    setSaving(true);
    try {
      const content = message.content.trim();
      if (content.length > (isSignedIn ? 300_000 : 100_000))
        throw new Error(
          "This response is too large for Library. Open the result and export the complete text instead.",
        );
      const codeRatio = (content.match(/```/g)?.length ?? 0) >= 2;
      let title: string;
      if (codeRatio) title = "Saved code response";
      else if (content.length > 1200) title = "Saved writing draft";
      else {
        const firstSentence = content.split(/(?<=[.!?])\s+/)[0] ?? content;
        const words = firstSentence.replace(/\s+/g, " ").split(" ").slice(0, 10).join(" ");
        title = words ? words.slice(0, 120) : "Saved chat response";
      }
      const payload = {
        title,
        item_type: (codeRatio ? "code" : "chat_artifact") as "code" | "chat_artifact",
        source: "chat" as const,
        content_text: message.content,
      };
      if (isSignedIn) await saveFn({ data: payload });
      else {
        const { saveGuestItem, loadGuestLibrary } = await import("@/lib/guest-library");
        if (!isCurrent()) return;
        const item = saveGuestItem(payload);
        if (!loadGuestLibrary().some((savedItem) => savedItem.id === item.id))
          throw new Error(
            "Library could not save on this device. Your response is preserved; copy or export it instead.",
          );
      }
      if (!isCurrent()) return;
      if (message.id) {
        try {
          savedIds.push(message.id);
          safeBrowserStorage("localStorage")?.setItem(
            dedupKey,
            JSON.stringify(savedIds.slice(-500)),
          );
        } catch {
          /* ignore */
        }
      }
      setSaved(true);
      toast.success("Saved to Library");
      if (artifactKind === "writing") openResult();
      setTimeout(() => {
        if (isCurrent()) setSaved(false);
      }, 2000);
    } catch (error) {
      if (isCurrent()) toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-message-role={message.role}
      className="kova-message group w-full px-4 py-3 text-base leading-[26px] sm:px-6 lg:px-8"
      aria-label={isUser ? "Your message" : "KovaGPT response"}
    >
      {isUser ? (
        <div className="mx-auto flex w-full kova-message-reading-column justify-start">
          <div className="kova-user-message-group flex w-full min-w-0 flex-col items-start">
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 justify-end">
                {message.attachments
                  .filter(
                    (attachment): attachment is Extract<typeof attachment, { kind: "image" }> =>
                      attachment.kind === "image",
                  )
                  .map((attachment, index) => (
                    <img
                      key={index}
                      src={attachment.dataUrl}
                      alt={
                        message.content?.trim()
                          ? `User-uploaded image: ${message.content.slice(0, 120)}`
                          : "User-uploaded image attached to message"
                      }
                      className="max-h-64 rounded-lg border border-border"
                    />
                  ))}
                {message.attachments
                  .filter((attachment) => attachment.kind !== "image")
                  .map((attachment) =>
                    attachment.kind === "library_file" ? (
                      <HistoricalLibraryAttachment
                        key={attachment.libraryItemId}
                        attachment={attachment}
                        ownerId={principalResolved && isSignedIn ? userKey : null}
                      />
                    ) : (
                      <span
                        key={`${attachment.name}:${attachment.size ?? 0}`}
                        className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/55 px-3 py-2 text-xs text-foreground"
                        title={attachment.name}
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="max-w-48 truncate">{attachment.name}</span>
                        <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                          Attached
                        </span>
                      </span>
                    ),
                  )}
              </div>
            )}
            {message.content && (
              <div className="kova-user-message prose-chat w-full whitespace-pre-wrap break-words rounded-xl border border-border bg-[var(--surface-secondary)] p-4 text-foreground">
                {message.content}
              </div>
            )}

            {(onEdit || onBranch) && (
              <div className="mt-1 flex min-h-9 items-center opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                {onEdit && (
                  <button
                    type="button"
                    onClick={onEdit}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Edit message"
                    title="Edit message"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {onBranch && (
                  <button
                    type="button"
                    onClick={onBranch}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Branch from this message in a new chat"
                    title="Branch in new chat"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="kova-assistant-message mx-auto flex kova-message-reading-column items-start justify-start">
          <div className="flex-1 min-w-0 min-h-8 [[data-sidebar=closed]_&]:min-h-9 flex flex-col justify-center select-text">
            <div className="mb-3 text-[13px] font-medium leading-[18px] text-muted-foreground">
              Kova
            </div>
            {message.activities
              ?.filter((activity) => activity.tool === "scheduled_task")
              .map((activity, index) => (
                <TaskCreatedBubble key={`schedule-${index}`} activity={activity} />
              ))}
            {visibleActivities &&
              visibleActivities.some((activity) => activity.tool !== "scheduled_task") && (
                <details className="mb-3 text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">
                    Activity
                  </summary>
                  <div className="flex flex-wrap gap-2">
                    {visibleActivities
                      .filter((activity) => activity.tool !== "scheduled_task")
                      .map((activity, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          {activity.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          ) : activity.status === "failed" ? (
                            <span className="font-semibold text-destructive" aria-hidden="true">
                              !
                            </span>
                          ) : activity.status === "canceled" ? (
                            <span
                              className="font-semibold text-muted-foreground"
                              aria-hidden="true"
                            >
                              ×
                            </span>
                          ) : (
                            <Check className="h-3 w-3 text-primary" />
                          )}
                          {activity.label}
                        </span>
                      ))}
                  </div>
                </details>
              )}
            {message.pendingConfirms?.map((confirm) => (
              <ToolConfirmCard
                key={confirm.actionId}
                confirm={confirm}
                onUpdate={(next) => onUpdatePendingConfirm?.(message.id, next)}
              />
            ))}
            <div
              ref={bodyRef}
              className="prose-chat"
              onMouseUp={rememberSelection}
              onKeyUp={rememberSelection}
            >
              {message.pendingImage && !message.content ? (
                <div
                  role="status"
                  className="flex min-h-24 items-center gap-3 rounded-xl border border-border bg-muted p-4"
                >
                  <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Generating image…</span>
                </div>
              ) : waitingForFirstToken ? (
                <StreamingStatus
                  activities={message.activities}
                  startedAt={resolvedStreamingStartedAt}
                />
              ) : (
                (() => {
                  const cleaned = cleanAssistantText(message.content);
                  const parts = extractCharts(cleaned);
                  const hasChart = parts.some((part) => part.kind === "chart");
                  const canvasParts = streaming ? [] : splitGenerativeContent(cleaned);
                  const hasWidget = canvasParts.some((part) => part.kind === "widget");
                  const markdown = hasWidget ? (
                    <div className="space-y-3">
                      {canvasParts.map((part, index) =>
                        part.kind === "widget" ? (
                          <GenerativeCanvas
                            key={`${principal}:${message.id}:${index}:${part.source}`}
                            widget={part.widget}
                            onOpenCanvas={
                              onOpenCanvas
                                ? (widget, trigger) =>
                                    onOpenCanvas(
                                      widget,
                                      trigger,
                                      `${message.id}:${index}:${part.source}`,
                                    )
                                : undefined
                            }
                            onOpenEditor={
                              onOpenResult
                                ? (content, kind, title) =>
                                    onOpenResult({
                                      title,
                                      initialContent: content,
                                      canvasSourceKey: `${message.id}:${index}:${part.source}:editor`,
                                      kind,
                                      initialMode: "edit",
                                      // A widget is a fragment of a response: never replace
                                      // the whole saved response with a fragment on autosave.
                                      chatId: null,
                                      messageId: null,
                                      projectId: null,
                                    })
                                : undefined
                            }
                          />
                        ) : part.text.trim() ? (
                          <ResponseMarkdown
                            key={index}
                            sources={message.sources}
                            onSourceClick={openSource}
                            onSaveImage={saveResponseImage}
                          >
                            {part.text}
                          </ResponseMarkdown>
                        ) : null,
                      )}
                    </div>
                  ) : hasChart ? (
                    <div className="space-y-2">
                      {parts.map((part, index) =>
                        part.kind === "chart" ? (
                          <Suspense key={index} fallback={null}>
                            <ChatChart spec={part.spec} />
                          </Suspense>
                        ) : part.value.trim() ? (
                          <ResponseMarkdown
                            key={index}
                            sources={message.sources}
                            onSourceClick={openSource}
                            onSaveImage={saveResponseImage}
                          >
                            {part.value}
                          </ResponseMarkdown>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <ResponseMarkdown
                      sources={message.sources}
                      onSourceClick={openSource}
                      onSaveImage={saveResponseImage}
                    >
                      {cleaned}
                    </ResponseMarkdown>
                  );
                  if (artifactKind || streaming) return markdown;
                  const chip = detectInfoChip(cleaned);
                  if (chip)
                    return (
                      <InfoChip
                        kind={chip}
                        rawText={cleaned}
                        userKey={userKey}
                        principalResolved={principalResolved}
                      >
                        {markdown}
                      </InfoChip>
                    );
                  return markdown;
                })()
              )}
              {streaming && message.content && <span className="cursor-blink" />}
            </div>
            {!streaming && message.generationStatus === "stopped" && (
              <div
                className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <span>Response stopped</span>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Retry stopped response"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {!streaming && selectedText && (
              <div
                ref={selectionActionsRef}
                className="kova-selection-actions mt-3 flex flex-wrap gap-2"
                role="toolbar"
                aria-label="Selected text actions"
                onPointerDown={(event) => {
                  // Only an intentional primary action keeps the native prose selection.
                  // Text dragging, secondary clicks, and the browser menu remain native.
                  if (
                    event.isPrimary &&
                    event.button === 0 &&
                    event.target instanceof Element &&
                    event.target.closest("button")
                  )
                    event.preventDefault();
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) rememberSelection();
                }}
              >
                {onDraftPrompt && (
                  <button
                    type="button"
                    onClick={() => {
                      responseDraftFocusRef.current = null;
                      setSelectionAskPassage(lastSelectionRef.current);
                      setSelectionQuestion("");
                      setSelectionAskOpen(true);
                    }}
                  >
                    Ask
                  </button>
                )}
                {onReplaceContent && (
                  <>
                    <button type="button" onClick={() => void openSelectionEdit()}>
                      Rewrite
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void openSelectionEdit("Shorten this passage while preserving its meaning.")
                      }
                    >
                      Shorten
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastSelectionRef.current);
                      toast.success("Selection copied");
                    } catch {
                      toast.error("Couldn’t copy. Select the text and copy it manually.");
                    }
                  }}
                >
                  Copy selection
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mx-auto kova-message-reading-column">
        <div className={isUser ? "flex justify-end" : "flex justify-start"}>
          {!streaming && !isUser && message.content && (
            <div
              className="kova-message-actions kova-response-action-bar mt-1 max-w-full overflow-x-auto"
              role="toolbar"
              aria-label="Response actions"
            >
              {isSignedIn &&
                principalResolved &&
                userKey &&
                chatId &&
                !temporary &&
                !message.generationStatus &&
                !message.pendingImage && (
                  <ResponseSpeechButton
                    ownerId={userKey}
                    chatId={chatId}
                    messageId={message.id}
                    content={message.content}
                  />
                )}
              {memorySources && (
                <button
                  type="button"
                  onClick={(event) => {
                    memoryReturnFocusRef.current = event.currentTarget;
                    memoryReturnUrlRef.current = window.location.href;
                    setMemoryOpenFor(memoryKey);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Memory provided ({memorySources.sources.length})
                </button>
              )}
              {message.sources?.length ? (
                <button
                  type="button"
                  ref={sourcesPillRef}
                  onClick={(event) => {
                    if (sourcesOpen) closeSources();
                    else openSources(event.currentTarget);
                  }}
                  className="kova-message-source-toggle inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-expanded={sourcesOpen}
                  aria-controls={`message-sources-${message.id}`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {message.sources.length} {message.sources.length === 1 ? "source" : "sources"}
                </button>
              ) : null}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={copy}
                      className="kova-message-icon-action inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent transition-colors duration-100"
                      aria-label={copied ? "Copied" : "Copy response"}
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-[color:var(--kova-blue)] animate-check-pop" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? "Copied" : "Copy response"}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void persistFeedback(feedback === "up" ? null : "up")}
                      disabled={feedbackSaving || feedbackLoadFailed}
                      className={`kova-message-icon-action inline-flex items-center justify-center p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                        feedback === "up" ? "bg-accent text-foreground" : ""
                      }`}
                      aria-label="Good response"
                      aria-pressed={feedback === "up"}
                    >
                      <ThumbsUp className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Good response</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void persistFeedback(feedback === "down" ? null : "down")}
                      disabled={feedbackSaving || feedbackLoadFailed}
                      className={`kova-message-icon-action inline-flex items-center justify-center p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                        feedback === "down" ? "bg-accent text-foreground" : ""
                      }`}
                      aria-label="Bad response"
                      aria-pressed={feedback === "down"}
                    >
                      <ThumbsDown className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Bad response</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void saveItem()}
                      disabled={saving}
                      className="kova-message-icon-action"
                      aria-label={
                        saved
                          ? "Saved to Library"
                          : saving
                            ? "Saving to Library"
                            : "Save to Library"
                      }
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : saved ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {saved ? "Saved to Library" : saving ? "Saving to Library" : "Save to Library"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {email && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 px-2.5 py-1.5 rounded-full transition-colors"
                      title="Open email draft"
                      aria-label="Open email draft"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Open email draft</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      Choose where to open a draft. Add recipients before sending.
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        await openEmailCompose("gmail", email.subject, email.body);
                        toast.success("Opening Gmail compose");
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" /> Open in Gmail
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        await openEmailCompose("outlook", email.subject, email.body);
                        toast.success("Opening Outlook compose");
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" /> Open in Outlook
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {message.content.trim() && (
                <button
                  type="button"
                  onClick={(event) => {
                    openResult("edit", event.currentTarget);
                  }}
                  className="kova-open-result-action inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent/80"
                  aria-label={artifactKind === "code" ? "Open code result" : "Open writing result"}
                  title={artifactKind === "code" ? "Open code result" : "Open writing result"}
                >
                  {artifactKind === "code" ? (
                    <Code2 className="h-3.5 w-3.5" />
                  ) : (
                    <FileEdit className="h-3.5 w-3.5" />
                  )}
                  <span>Edit in Canvas</span>
                </button>
              )}
              {chatId && onReplaceContent && (
                <button
                  type="button"
                  onClick={() => {
                    setCompareVersions(true);
                    setVersionsOpen(true);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Compare response versions"
                >
                  <History className="h-3.5 w-3.5" aria-hidden="true" /> Compare versions
                </button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={responseMoreRef}
                    className="kova-message-icon-action inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="kova-response-menu w-60"
                  onCloseAutoFocus={(event) => {
                    const focusDraft = responseDraftFocusRef.current;
                    if (focusDraft) {
                      responseDraftFocusRef.current = null;
                      event.preventDefault();
                      focusDraft();
                      return;
                    }
                    if (memoryReviewOpeningRef.current) {
                      memoryReviewOpeningRef.current = false;
                      event.preventDefault();
                      return;
                    }
                    if (!studyOpeningRef.current) return;
                    studyOpeningRef.current = false;
                    event.preventDefault();
                  }}
                >
                  {onRetry && (
                    <DropdownMenuItem onSelect={onRetry}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Retry
                    </DropdownMenuItem>
                  )}
                  {onDraftPrompt && (
                    <DropdownMenuItem
                      aria-label="Continue from here"
                      aria-describedby={`continue-draft-${message.id}`}
                      onSelect={() => {
                        responseDraftFocusRef.current =
                          onDraftPrompt(
                            "Continue from here without repeating what you have already written.",
                          ) ?? null;
                      }}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      <span>
                        Continue from here
                        <span
                          id={`continue-draft-${message.id}`}
                          className="block text-xs text-muted-foreground"
                        >
                          Adds to your draft. Send when ready.
                        </span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {chatId && !temporary && (
                    <DropdownMenuItem
                      onSelect={async () => {
                        try {
                          const link = new URL(window.location.href);
                          link.hash = `message-${message.id}`;
                          await navigator.clipboard.writeText(link.toString());
                          toast.success("Link copied. Access is unchanged.");
                        } catch {
                          toast.error("Couldn’t copy the link.");
                        }
                      }}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy link
                    </DropdownMenuItem>
                  )}
                  {feedbackLoadFailed ? (
                    <DropdownMenuItem onSelect={() => setFeedbackReload((current) => current + 1)}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Retry loading response feedback
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => void share()}>
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void saveItem()} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : saved ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Bookmark className="mr-2 h-4 w-4" />
                    )}
                    {saving ? (
                      <span className="spec400-loading-label">
                        <span className="spec400-loading-spinner" aria-hidden="true" />
                        Saving…
                      </span>
                    ) : saved ? (
                      "Saved to Library"
                    ) : (
                      "Save to Library"
                    )}
                  </DropdownMenuItem>
                  {onSaveMemory ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        memoryReviewOpeningRef.current = true;
                        onSaveMemory(responseMoreRef.current);
                      }}
                    >
                      <Brain className="mr-2 h-4 w-4" /> Save a reviewed memory
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={openStudy}
                    disabled={!principalResolved || !message.content.trim()}
                  >
                    <GraduationCap className="mr-2 h-4 w-4" /> Practice this explanation
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void openSelectionEdit();
                    }}
                    disabled={!onReplaceContent}
                  >
                    <TextSelect className="mr-2 h-4 w-4" /> Edit selection
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setCompareVersions(false);
                      setVersionsOpen(true);
                    }}
                    disabled={!chatId || !message.id}
                  >
                    <History className="mr-2 h-4 w-4" /> Version history
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onBranch} disabled={!onBranch}>
                    <GitBranch className="mr-2 h-4 w-4" /> Branch into new chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
      {!isUser &&
        !streaming &&
        !message.generationStatus &&
        onSelectSuggestion &&
        normalizeResponseFollowups(message.followups).length > 0 && (
          <nav className="kova-response-followups" aria-label="Suggested follow-ups">
            {normalizeResponseFollowups(message.followups).map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => onSelectSuggestion(suggestion)}>
                <CornerDownRight aria-hidden="true" />
                <span>{suggestion}</span>
              </button>
            ))}
          </nav>
        )}
      {studySession?.key === studyContextKey && (
        <Suspense
          fallback={
            <p className="sr-only" role="status">
              Loading practice…
            </p>
          }
        >
          <ChatStudyControl
            key={studySession.key}
            open
            ownerId={userKey}
            temporary={temporary}
            source={studySession.source}
            onOpenChange={(open) => {
              if (!open) setStudySession(null);
            }}
            onRestoreFocus={() => {
              if (studySession.key !== studyContextRef.current) return;
              restoreDialogFocus(studyReturnFocusRef.current, studyReturnUrlRef.current);
            }}
          />
        </Suspense>
      )}
      {!isUser && message.content.trim() && (
        <Suspense fallback={null}>
          <ArtifactEditor
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            initialContent={editorContent}
            kind={artifactKind ?? "writing"}
            onImprove={onFollowUp}
            initialMode={editorMode}
            chatId={temporary ? null : (chatId ?? null)}
            messageId={temporary ? null : (message.id ?? null)}
            projectId={temporary ? null : (projectId ?? null)}
          />
        </Suspense>
      )}
      {sourcesOpen && sourcesSession && message.sources?.length ? (
        <Dialog
          open={sourcesOpen}
          onOpenChange={(open) => {
            if (!open) closeSources();
          }}
        >
          <DialogContent
            id={`message-sources-${message.id}`}
            className="kova-sources-inspector"
            aria-describedby="response-sources-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // A delayed close belongs only to this opening, never a newer inspector.
              if (sourcesReturnFocusRef.current !== sourcesSession) return;
              sourcesReturnFocusRef.current = null;
              if (sourcesSession.key !== sourcesContextRef.current) return;
              const active = document.activeElement;
              const closingContent = event.target instanceof HTMLElement ? event.target : null;
              if (
                active &&
                active !== document.body &&
                active !== sourcesSession.trigger &&
                !closingContent?.contains(active)
              )
                return;
              restoreDialogFocus(sourcesSession.trigger, sourcesSession.openedUrl);
            }}
          >
            <DialogHeader>
              <DialogTitle>Sources</DialogTitle>
              <DialogDescription id="response-sources-description">
                Sources returned with this response. Select a citation to inspect its supporting
                passage.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-4 overflow-y-auto">
              {message.sources.map((source) => {
                const retrievedAt = normalizeSourceRetrievedAt(source.retrievedAt);
                return (
                  <li
                    key={source.id}
                    id={`source-${source.id}`}
                    className={`rounded-xl border p-4 ${source.id === activeSourceId ? "border-ring" : "border-border"}`}
                  >
                    <p className="text-xs text-muted-foreground">Web page</p>
                    <h3 className="mt-1 text-base font-medium">{source.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Publisher: {source.domain}</p>
                    {source.publishedAt && (
                      <p className="text-sm text-muted-foreground">
                        Published: {source.publishedAt}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {retrievedAt ? (
                        <>
                          Retrieved:{" "}
                          <time dateTime={retrievedAt}>
                            {formatDisplayDateTime(retrievedAt, timeFormat)}
                          </time>{" "}
                          (device time zone)
                        </>
                      ) : (
                        "Retrieval time not provided"
                      )}
                    </p>
                    {source.snippet ? (
                      <p className="mt-3 text-sm leading-relaxed">{source.snippet}</p>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No supporting passage was provided.
                      </p>
                    )}
                    <a
                      className="mt-3 block break-all text-sm underline"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {source.url}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-border px-4"
              onClick={closeSources}
            >
              Close Sources
            </button>
          </DialogContent>
        </Dialog>
      ) : null}
      {selectionAskOpen && (
        <Dialog open onOpenChange={setSelectionAskOpen}>
          <DialogContent
            onCloseAutoFocus={(event) => {
              const focusDraft = responseDraftFocusRef.current;
              if (!focusDraft) return;
              responseDraftFocusRef.current = null;
              event.preventDefault();
              focusDraft();
            }}
          >
            <DialogHeader>
              <DialogTitle>Ask about this passage</DialogTitle>
              <DialogDescription>
                Your question and selected text will be added to your draft. Send when ready.
              </DialogDescription>
            </DialogHeader>
            <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm">
              {selectionAskPassage}
            </p>
            <label htmlFor={`selection-question-${message.id}`}>Your question</label>
            <textarea
              id={`selection-question-${message.id}`}
              className="min-h-24 rounded-lg border p-3"
              value={selectionQuestion}
              onChange={(event) => setSelectionQuestion(event.target.value)}
            />
            <button
              type="button"
              disabled={!selectionQuestion.trim()}
              className="min-h-11 rounded-lg bg-foreground px-4 text-background disabled:opacity-50"
              onClick={() => {
                responseDraftFocusRef.current =
                  onDraftPrompt?.(
                    `${selectionQuestion.trim()}\n\nSelected passage:\n${selectionAskPassage}`,
                  ) ?? null;
                setSelectionAskOpen(false);
              }}
            >
              Add to draft
            </button>
          </DialogContent>
        </Dialog>
      )}
      {memorySources && memoryOpenFor === memoryKey && (
        <Suspense fallback={null}>
          <MemorySourcesDialog
            sources={memorySources}
            onClose={closeMemory}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreDialogFocus(
                memoryReturnFocusRef.current,
                memoryReturnUrlRef.current,
                memoryContextRef.current !== memoryKey,
              );
            }}
          />
        </Suspense>
      )}
      {copyFallbackOpen && (
        <Dialog open={copyFallbackOpen} onOpenChange={setCopyFallbackOpen}>
          <DialogContent
            className="sm:max-w-[640px]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              copyFallbackRef.current?.focus();
              copyFallbackRef.current?.select();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreDialogFocus(copyFallbackReturnRef.current, copyFallbackReturnUrlRef.current);
            }}
          >
            <DialogHeader>
              <DialogTitle>Copy response</DialogTitle>
              <DialogDescription>
                Copy is unavailable here. Select this text and copy it manually.
              </DialogDescription>
            </DialogHeader>
            <textarea
              ref={copyFallbackRef}
              readOnly
              value={message.content}
              aria-label="Response text to copy"
              rows={10}
              className="max-h-[50vh] w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  copyFallbackRef.current?.focus();
                  copyFallbackRef.current?.select();
                }}
                className="min-h-11 rounded-full border border-border px-4 text-sm font-medium hover:bg-accent"
              >
                Select text
              </button>
              <button
                type="button"
                onClick={() => setCopyFallbackOpen(false)}
                className="min-h-11 rounded-full bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {!isUser && (selectionOpen || versionsOpen) && (
        <Suspense fallback={null}>
          {selectionOpen && (
            <SelectionEditDialog
              open={selectionOpen}
              onOpenChange={(open) => {
                setSelectionOpen(open);
                if (!open) setSelectionTarget(null);
              }}
              target={selectionTarget}
              initialInstruction={selectionInstruction}
              chatId={chatId ?? null}
              messageId={message.id ?? null}
              temporary={temporary}
              onApply={(next) => onReplaceContent?.(message.id, next)}
            />
          )}
          {versionsOpen && (
            <MessageVersionHistoryDialog
              open={versionsOpen}
              onOpenChange={setVersionsOpen}
              compareInitially={compareVersions}
              chatId={chatId ?? null}
              messageId={message.id ?? null}
              currentContent={message.content}
              onRestore={(next) => onReplaceContent?.(message.id, next)}
            />
          )}
        </Suspense>
      )}
      {!isUser && message.content && (
        <MobileBottomSheet
          open={mobileSheetOpen}
          onOpenChange={setMobileSheetOpen}
          title="Message actions"
          restoreFocus={!copyFallbackOpen && !selectionOpen && !versionsOpen && !sourcesOpen}
        >
          <div className="flex flex-col py-1">
            {[
              {
                label: copied ? "Copied" : "Copy",
                icon: Copy,
                onClick: () => {
                  copy();
                  setMobileSheetOpen(false);
                },
              },
              {
                label: "Share",
                icon: Share2,
                onClick: async () => {
                  setMobileSheetOpen(false);
                  await share();
                },
              },
              ...(message.sources?.length
                ? [
                    {
                      label: sourcesOpen
                        ? "Hide sources"
                        : `View ${message.sources.length} sources`,
                      icon: Globe,
                      onClick: () => {
                        if (sourcesOpen) closeSources();
                        else openSources(sourcesPillRef.current);
                        setMobileSheetOpen(false);
                      },
                    },
                  ]
                : []),
              ...(onReplaceContent
                ? [
                    {
                      label: "Edit selection",
                      icon: TextSelect,
                      onClick: () => {
                        setMobileSheetOpen(false);
                        void openSelectionEdit();
                      },
                    },
                  ]
                : []),
              ...(chatId && message.id
                ? [
                    {
                      label: "Version history",
                      icon: History,
                      onClick: () => {
                        setMobileSheetOpen(false);
                        setVersionsOpen(true);
                      },
                    },
                  ]
                : []),
              ...(onEdit
                ? [
                    {
                      label: "Edit",
                      icon: Pencil,
                      onClick: () => {
                        onEdit();
                        setMobileSheetOpen(false);
                      },
                    },
                  ]
                : []),
              ...(onRetry && message.generationStatus !== "stopped"
                ? [
                    {
                      label: retryActionLabel,
                      icon: RefreshCw,
                      onClick: () => {
                        onRetry();
                        setMobileSheetOpen(false);
                      },
                    },
                  ]
                : []),
              ...(onBranch
                ? [
                    {
                      label: "Branch in new chat",
                      icon: GitBranch,
                      onClick: () => {
                        onBranch();
                        setMobileSheetOpen(false);
                      },
                    },
                  ]
                : []),
              {
                label: "Search the web",
                icon: Globe,
                onClick: () => {
                  const query = encodeURIComponent(message.content.slice(0, 300));
                  window.open(
                    `https://www.google.com/search?q=${query}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                  setMobileSheetOpen(false);
                },
              },
              ...(onSaveMemory
                ? [
                    {
                      label: "Save a reviewed memory",
                      icon: Brain,
                      onClick: () => {
                        setMobileSheetOpen(false);
                        onSaveMemory(responseMoreRef.current);
                      },
                    },
                  ]
                : []),
              {
                label: saved ? "Saved" : "Save to Library",
                icon: Bookmark,
                onClick: () => {
                  saveItem();
                  setMobileSheetOpen(false);
                },
              },
            ].map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="flex items-center gap-3 px-4 py-3 text-left text-[15px] rounded-lg hover:bg-accent active:bg-accent/70 transition"
              >
                <action.icon className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="flex-1">{action.label}</span>
              </button>
            ))}
          </div>
        </MobileBottomSheet>
      )}
    </article>
  );
}

export const ChatMessage = memo(ChatMessageInner);
