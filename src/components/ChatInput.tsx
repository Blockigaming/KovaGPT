import {
  ArrowUp,
  Mic,
  AudioLines,
  Paperclip,
  Plus,
  Square,
  X,
  Image as ImageIcon,
  ImagePlus,
  Globe,
  FileText,
  Camera,
  LibraryBig,
  Pencil,
  Folder,
  Files,
  AlertCircle,
  RotateCcw,
  Maximize2,
  SlidersHorizontal,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import {
  attachmentPreviewWindow,
  LOCAL_PASTE_THRESHOLD,
  pasteAttachmentIntoDraft,
  prepareLocalPaste,
} from "@/lib/composer-local-attachments.mjs";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import type { Settings } from "@/components/SettingsDialog";
import { ComposerPdfPages } from "@/components/ComposerPdfPages";
import {
  PdfTextUnavailableError,
  pdfDocumentText,
  selectPdfPages,
  formatPdfPageNumbers,
  type PdfExtractionMetadata,
} from "@/lib/document-extraction/pdf-metadata.mjs";
import { ComposerUploadAllowance } from "@/components/ComposerUploadAllowance";
import { ComposerContextPanel } from "@/components/ComposerContextPanel";
import { ComposerModelStatus } from "@/components/ComposerModelStatus";
import { ComposerVoiceDialog } from "@/components/ComposerVoiceDialog";
import type { ComposerVoiceTurn } from "@/lib/composer-voice-turn";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useLibraryAttachmentAutoSave } from "@/hooks/use-library-attachment-auto-save";
import { useLayout } from "@/hooks/use-mobile";
import { useSharedSendOnEnter } from "@/lib/composer-preferences";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import { type ModeId, type Tier } from "@/lib/modes";
import { shouldSubmitComposerOnEnter } from "@/lib/composer-keyboard.mjs";
import type { ComposerToolId, Conversation } from "@/lib/chat-store";

import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ComposerDrawingDialog } from "@/components/ComposerDrawingDialog";
import { ComposerPluginList } from "@/components/ComposerPluginList";
const ComposerSignInDialog = lazy(() =>
  import("@/components/ComposerSignInDialog").then((module) => ({
    default: module.ComposerSignInDialog,
  })),
);
const ComposerProjectPicker = lazy(() =>
  import("@/components/ComposerProjectPicker").then((module) => ({
    default: module.ComposerProjectPicker,
  })),
);

export type PendingAttachment = {
  clientId?: string;
  source?: "file_upload" | "library";
  kind: "image" | "text_file" | "library_file";
  dataUrl: string;
  textContent?: string;
  /** Local clipboard input; it is not uploaded or saved before explicit Send. */
  localPaste?: boolean;
  pasteOrigin?: { original: string; start: number; end: number };
  name: string;
  size?: number;
  status?: "selected" | "uploading" | "complete" | "failed";
  error?: string;
  /** Readability note returned by the actual document extractor. */
  extractionNote?: string;
  /** Full local parser observations, never reconstructed from saved text markers. */
  pdf?: PdfExtractionMetadata;
  /** Subset of extracted pages currently composed into textContent. */
  selectedPdfPages?: number[];
  libraryItemId?: string;
  fileType?: string | null;
  sourceProject?: string | null;
  createdAt?: string | null;
};

export type RecentLibraryFile = {
  id: string;
  title: string;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  createdAt?: string | null;
  projectName?: string | null;
};
export type { ComposerToolId } from "@/lib/chat-store";

type ComposerAction = {
  id: ComposerToolId;
  label: string;
  icon: LucideIcon;
};

const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "image", label: "Create Image", icon: ImagePlus },
];

const TEXT_LIKE_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|sh|bash|zsh|fish|env|ini|conf|log|srt|vtt)$/i;
const MAX_TEXT_FILE_BYTES = 256 * 1024; // 256 KB inline cap to keep prompts reasonable
const MAX_IMAGE_FILE_BYTES = 3 * 1024 * 1024; // bounded for inline vision requests and device history

const subscribeToOnlineStatus = (onStoreChange: () => void) => {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
};
const getOnlineStatusSnapshot = () => navigator.onLine !== false;
const getServerOnlineStatusSnapshot = () => true;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  onSendNext,
  sendNextDisabled = false,
  nextPromptPanel,
  requestStatusPanel,
  isStreaming,

  sendOnEnter,

  disabled = false,
  sendDisabled = false,
  showAddMenu = true,
  saveAttachmentsToLibrary = false,
  attachments,
  onAttachmentsChange,
  mode,
  onModeChange,
  userTier = "free",
  canChangeAgent = true,
  showModelStatus = false,
  readOnlyContext,
  onOpenChatContext,
  chatRulesActive = false,
  placeholder,
  selectedTool,
  onToolSelect,
  recentLibraryFiles = [],
  recentLibraryLoading = false,
  recentLibraryError = null,
  onRecentLibraryRetry,
  showChooseProject = false,
  savedConversations = [],
  surface = "conversation",
  attachmentContext,
  latestAssistantText = "",
  latestAssistantReply,
  voiceMode,
  onVoiceModeChange,
  onVoiceSubmit,
  responseSettings,
  onResponseSettingsChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (tool?: ComposerToolId | null) => void | Promise<unknown>;
  onStop: () => void;
  /** Explicitly snapshot one next message; ordinary typing and Enter never enqueue. */
  onSendNext?: (tool?: ComposerToolId | null, trigger?: HTMLButtonElement | null) => boolean;
  sendNextDisabled?: boolean;
  nextPromptPanel?: ReactNode;
  requestStatusPanel?: ReactNode | ((hasPendingMessage: boolean) => ReactNode);
  isStreaming: boolean;

  /** Explicit override. When omitted, the current user's shared persisted preference is used. */
  sendOnEnter?: boolean;

  /** Disables text entry and submission without changing existing callers. */
  disabled?: boolean;
  sendDisabled?: boolean;
  /** Hides and disables attachments, tools, and prompt shortcuts. */
  showAddMenu?: boolean;
  /** Only persistent, authenticated chat may automatically retain uploads. */
  saveAttachmentsToLibrary?: boolean;
  attachments: PendingAttachment[];
  onAttachmentsChange: (a: PendingAttachment[]) => void;
  mode?: ModeId;
  onModeChange?: (m: ModeId) => void;
  userTier?: Tier;
  /** Guests use the basic agent and cannot change versions or reasoning levels. */
  canChangeAgent?: boolean;
  /** Show grounded availability information without enabling model or agent selection. */
  showModelStatus?: boolean;
  /** Read-only context for callers whose send contract does not support attachments. */
  readOnlyContext?: { title: string; description: string; content: ReactNode };
  onOpenChatContext?: (trigger: HTMLElement | null) => void;
  chatRulesActive?: boolean;
  /** Called when the user hits their daily upload quota. */
  onUploadLimit?: () => void;
  placeholder?: string;
  onPromptShortcut?: (prompt: string) => void;
  selectedTool?: ComposerToolId | null;
  onToolSelect?: (tool: ComposerToolId | null) => void;
  recentLibraryFiles?: RecentLibraryFile[];
  recentLibraryLoading?: boolean;
  recentLibraryError?: string | null;
  onRecentLibraryRetry?: () => void;
  showChooseProject?: boolean;
  savedConversations?: readonly Conversation[];
  /** Controls whether the desktop add menu opens below the centered composer or above a docked one. */
  surface?: "empty" | "conversation";
  /** Invalidate pending reads when changing chat or entering/leaving prompt edit. */
  attachmentContext?: string;
  /** Completed assistant reply available for explicitly requested speech playback. */
  latestAssistantText?: string;
  /** Exact saved, model-proven reply; text alone never authorizes playback. */
  latestAssistantReply?: { chatId: string; messageId: string; content: string };
  /** Controlled by the chat route so opening a new voice chat survives layout changes. */
  voiceMode?: "dictate" | "voice" | null;
  onVoiceModeChange?: (mode: "dictate" | "voice" | null) => void;
  /** Uses the existing chat/history path and returns only a confirmed saved reply. */
  onVoiceSubmit?: (text: string, signal: AbortSignal) => Promise<ComposerVoiceTurn>;
  responseSettings?: Pick<Settings, "responseLength" | "responseFormat" | "responseTone">;
  onResponseSettingsChange?: (
    change: Partial<Pick<Settings, "responseLength" | "responseFormat" | "responseTone">>,
  ) => void;
}) {
  const { isDesktop, interaction } = useLayout();
  const { user, isLoaded } = useUser();
  const fileAccountRef = useRef({ isLoaded, userId: user?.id ?? null });
  fileAccountRef.current = { isLoaded, userId: user?.id ?? null };
  const navigate = useNavigate();
  const attachmentAutoSave = useLibraryAttachmentAutoSave(
    saveAttachmentsToLibrary && isLoaded && !disabled,
    user?.id ?? null,
  );
  const pasteGenerationRef = useRef(0);
  const attachmentContextRef = useRef({
    context: attachmentContext,
    scope: attachmentAutoSave.scope,
  });
  if (
    attachmentContextRef.current.context !== attachmentContext ||
    attachmentContextRef.current.scope !== attachmentAutoSave.scope
  ) {
    // Fresh identity on every transition: A → B → A must not revive an old read.
    attachmentContextRef.current = { context: attachmentContext, scope: attachmentAutoSave.scope };
  }
  const [pasteOffer, setPasteOffer] = useState<{
    id: string;
    text: string;
    original: string;
    start: number;
    end: number;
    size: number;
    error?: string;
  } | null>(null);
  const composerStateRef = useRef({ value, attachments });
  composerStateRef.current = { value, attachments };
  const updateAttachments = (next: PendingAttachment[]) => {
    composerStateRef.current.attachments = next;
    onAttachmentsChange(next);
  };
  const uploadBatchRef = useRef(false);
  useEffect(() => {
    setPasteOffer(null);
  }, [attachmentAutoSave.scope, attachmentContext]);
  const documentReadsRef = useRef(new Set<AbortController>());
  const documentReadIdsRef = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const controller of documentReadsRef.current) controller.abort();
      documentReadsRef.current.clear();
    },
    [attachmentAutoSave.scope, attachmentContext],
  );
  const attachmentScopeRef = useRef(attachmentAutoSave.scope);
  attachmentScopeRef.current = attachmentAutoSave.scope;
  const sharedSendOnEnter = useSharedSendOnEnter(user?.id ?? null);
  const effectiveSendOnEnter = sendOnEnter ?? sharedSendOnEnter;
  const isMobileLayout = !isDesktop;
  const isCoarsePointer = interaction === "touch";

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const plusTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsReturnTriggerRef = useRef<HTMLElement | null>(null);
  const optionsReturnUrlRef = useRef<string | undefined>(undefined);
  const [previewAttachment, setPreviewAttachment] = useState<PendingAttachment | null>(null);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [pastePreviewOpen, setPastePreviewOpen] = useState(false);
  const [removedPaste, setRemovedPaste] = useState<PendingAttachment | null>(null);
  const previewReturnToInputRef = useRef(false);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const undoPasteButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedToolRef = useRef(selectedTool);
  selectedToolRef.current = selectedTool;

  const [plusOpen, setPlusOpen] = useState(false);
  const [composerFocusOrigin, setComposerFocusOrigin] = useState<"keyboard" | "pointer">(
    "keyboard",
  );
  const [utilityMenu, setUtilityMenu] = useState<"files" | "plugins" | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectReturnUrlRef = useRef<string | undefined>(undefined);
  const [signInRequest, setSignInRequest] = useState<{
    description: string;
    pluginId?: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const contextSwitchingDialogRef = useRef(false);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const contextReturnToInputRef = useRef(false);
  const contextReturnUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    setContextOpen(false);
    setExpanded(false);
    setOptionsOpen(false);
    optionsReturnTriggerRef.current = null;
    optionsReturnUrlRef.current = undefined;
    setPreviewAttachment(null);
    setPreviewOffset(0);
    setPastePreviewOpen(false);
    setRemovedPaste(null);
    setProjectPickerOpen(false);
    setSignInRequest(null);
    setPlusOpen(false);
    setUtilityMenu(null);
    setLibraryOpen(false);
    setDrawingOpen(false);
    contextReturnToInputRef.current = false;
  }, [isLoaded, user?.id, attachmentContext]);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineStatusSnapshot,
    getServerOnlineStatusSnapshot,
  );
  const [localVoiceMode, setLocalVoiceMode] = useState<"dictate" | "voice" | null>(null);
  const activeVoiceMode = voiceMode === undefined ? localVoiceMode : voiceMode;
  const voiceMountedRef = useRef(true);
  const voiceModeRef = useRef(activeVoiceMode);
  voiceModeRef.current = activeVoiceMode;
  useEffect(() => {
    voiceMountedRef.current = true;
    return () => {
      voiceMountedRef.current = false;
      voiceModeRef.current = null;
    };
  }, []);
  const voiceContextKey = attachmentContext ?? "composer";
  const voiceIdentityRef = useRef({
    isLoaded,
    userId: user?.id ?? null,
    contextKey: voiceContextKey,
  });
  if (
    voiceIdentityRef.current.isLoaded !== isLoaded ||
    voiceIdentityRef.current.userId !== (user?.id ?? null) ||
    voiceIdentityRef.current.contextKey !== voiceContextKey
  ) {
    // A -> B -> A must never revive an old transcript or submission callback.
    voiceIdentityRef.current = { isLoaded, userId: user?.id ?? null, contextKey: voiceContextKey };
  }
  const voiceScope = voiceIdentityRef.current;
  const previousVoiceScopeRef = useRef(voiceScope);
  const voiceOpeningBlocked =
    Boolean(pasteOffer) ||
    uploadBatchRef.current ||
    documentReadsRef.current.size > 0 ||
    attachments.some((attachment) => attachment.status === "uploading");
  const voiceCallbacksRef = useRef({
    onChange,
    onVoiceSubmit,
    onVoiceModeChange,
    voiceOpeningBlocked,
    disabled,
    isStreaming,
    online,
  });
  voiceCallbacksRef.current = {
    onChange,
    onVoiceSubmit,
    onVoiceModeChange,
    voiceOpeningBlocked,
    disabled,
    isStreaming,
    online,
  };
  const voiceTriggerRef = useRef<HTMLElement | null>(null);
  const voiceReturnUrlRef = useRef<string | undefined>(undefined);
  const voiceDraftAppliedRef = useRef(false);
  const setVoiceOpenMode = (next: "dictate" | "voice" | null) => {
    voiceModeRef.current = next;
    setLocalVoiceMode(next);
    voiceCallbacksRef.current.onVoiceModeChange?.(next);
  };
  useEffect(() => {
    if (previousVoiceScopeRef.current !== voiceScope || disabled || !online) {
      previousVoiceScopeRef.current = voiceScope;
      voiceModeRef.current = null;
      setLocalVoiceMode(null);
      voiceCallbacksRef.current.onVoiceModeChange?.(null);
    }
  }, [voiceScope, disabled, online]);
  const openVoice = (next: "dictate" | "voice", trigger: HTMLElement) => {
    const latest = voiceCallbacksRef.current;
    if (
      !voiceMountedRef.current ||
      voiceIdentityRef.current !== voiceScope ||
      !voiceScope.isLoaded ||
      latest.disabled ||
      latest.isStreaming ||
      !latest.online ||
      (next === "voice" &&
        (!voiceScope.userId || !latest.onVoiceSubmit || latest.voiceOpeningBlocked))
    )
      return;
    voiceTriggerRef.current = trigger;
    voiceReturnUrlRef.current = window.location.href;
    voiceDraftAppliedRef.current = false;
    setPlusOpen(false);
    setOptionsOpen(false);
    setVoiceOpenMode(next);
  };
  const acceptVoiceTranscript = (text: string) => {
    const latest = voiceCallbacksRef.current;
    if (
      !voiceMountedRef.current ||
      voiceIdentityRef.current !== voiceScope ||
      voiceModeRef.current !== "dictate" ||
      !voiceScope.isLoaded ||
      !voiceScope.userId ||
      latest.disabled ||
      latest.isStreaming ||
      !latest.online ||
      !text.trim()
    )
      return;
    const draft = composerStateRef.current.value;
    const next = draft ? `${draft}${draft.endsWith("\n") ? "" : "\n"}${text.trim()}` : text.trim();
    composerStateRef.current.value = next;
    voiceDraftAppliedRef.current = true;
    latest.onChange(next);
  };
  const submitVoiceTranscript = async (
    text: string,
    signal: AbortSignal,
  ): Promise<ComposerVoiceTurn> => {
    const latest = voiceCallbacksRef.current;
    if (
      !voiceMountedRef.current ||
      voiceIdentityRef.current !== voiceScope ||
      voiceModeRef.current !== "voice" ||
      !voiceScope.isLoaded ||
      !voiceScope.userId ||
      latest.disabled ||
      latest.isStreaming ||
      !latest.online ||
      signal.aborted ||
      !latest.onVoiceSubmit ||
      !text.trim()
    )
      throw new Error("voice_turn_cancelled");
    const reply = await latest.onVoiceSubmit(text.trim(), signal);
    if (
      !voiceMountedRef.current ||
      voiceIdentityRef.current !== voiceScope ||
      voiceModeRef.current !== "voice" ||
      voiceCallbacksRef.current.disabled ||
      !voiceCallbacksRef.current.online ||
      signal.aborted ||
      reply.ownerId !== voiceScope.userId
    )
      throw new Error("voice_turn_cancelled");
    return reply;
  };
  const [kbOffset, setKbOffset] = useState(0);
  const submittingRef = useRef(false);
  const streamingRef = useRef(isStreaming);
  streamingRef.current = isStreaming;
  const composingRef = useRef(false);
  const [uploadAnnouncement, setUploadAnnouncement] = useState("");
  const [recentQuery, setRecentQuery] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      const limit = isMobileLayout ? 144 : 240;
      const minimum = 26;
      const metrics = window.getComputedStyle(el);
      const singleLine = Math.max(
        parseFloat(metrics.minHeight) || 0,
        parseFloat(metrics.lineHeight) +
          parseFloat(metrics.paddingTop) +
          parseFloat(metrics.paddingBottom),
      );
      const composer = el.closest<HTMLElement>(".spec400-composer");
      if (composer && !isMobileLayout) {
        // Measure against the compact text slot even while the draft is expanded.
        // Measuring only the current wider row would repeatedly expand/collapse
        // drafts that fit one wide line but not the compact input slot.
        const groupWidth = (selector: string) => {
          const group = composer.querySelector<HTMLElement>(selector);
          if (!group) return 0;
          const controls = Array.from(group.children).filter(
            (node) => node.getClientRects().length,
          );
          const gap = parseFloat(window.getComputedStyle(group).columnGap) || 0;
          return (
            controls.reduce((width, node) => width + node.getBoundingClientRect().width, 0) +
            Math.max(0, controls.length - 1) * gap
          );
        };
        const composerMetrics = window.getComputedStyle(composer);
        const compactPadding =
          parseFloat(composerMetrics.getPropertyValue("--composer-compact-padding")) || 7;
        const compactGap =
          parseFloat(composerMetrics.getPropertyValue("--composer-compact-gap")) || 8;
        const compactWidth = Math.max(
          48,
          composer.clientWidth -
            compactPadding * 2 -
            compactGap * 2 -
            groupWidth(".spec400-composer-tools") -
            groupWidth(".spec400-composer-trailing"),
        );
        const previousWidth = el.style.width;
        el.style.width = `${compactWidth}px`;
        el.style.height = "0px";
        el.dataset.multiline = String(el.scrollHeight > singleLine + 1);
        el.style.width = previousWidth;
      } else {
        el.style.height = "0px";
        el.dataset.multiline = String(el.scrollHeight > singleLine + 1);
      }
      el.style.height = "0px";
      const height = Math.min(Math.max(el.scrollHeight, minimum), limit);
      el.style.height = `${height}px`;
      el.style.overflowY = el.scrollHeight > limit ? "auto" : "hidden";
    };
    resize();
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = el.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, isLoaded, user?.id, isMobileLayout, surface]);

  // Track on-screen keyboard on mobile so the composer floats above it.
  useEffect(() => {
    if (!isMobileLayout || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const bottomGap = window.innerHeight - (vv.height + vv.offsetTop);
      setKbOffset(bottomGap > 40 ? bottomGap : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isStreaming) submittingRef.current = false;
  }, [isStreaming, value, attachments.length]);

  useEffect(() => {
    if (disabled || !showAddMenu) setPlusOpen(false);
  }, [disabled, showAddMenu]);
  useEffect(() => {
    if (disabled || isStreaming || !showAddMenu || isMobileLayout) setUtilityMenu(null);
  }, [disabled, isStreaming, showAddMenu, isMobileLayout]);

  const validAttachmentInstruction = attachments.some(
    (attachment) =>
      attachment.status !== "failed" &&
      attachment.status !== "uploading" &&
      (attachment.kind === "image"
        ? Boolean(attachment.dataUrl)
        : attachment.kind === "text_file"
          ? Boolean(attachment.textContent?.trim())
          : Boolean(attachment.libraryItemId)),
  );
  const blockedAttachment = attachments.find(
    (attachment) => attachment.status === "uploading" || attachment.status === "failed",
  );
  const blockedAttachmentMessage = blockedAttachment
    ? blockedAttachment.status === "uploading"
      ? `Wait for ${blockedAttachment.name} to finish.`
      : `Remove or retry ${blockedAttachment.name} before sending.`
    : null;

  const requireFileAccount = (trigger: HTMLElement | null = ref.current) => {
    const account = fileAccountRef.current;
    if (!account.isLoaded) return false;
    // A callback from an earlier account must not resume after a sign-in/switch.
    if (account.userId) return account.userId === (user?.id ?? null);
    setPlusOpen(false);
    setUtilityMenu(null);
    setDrawingOpen(false);
    setSignInRequest({
      description:
        "Sign in to upload or create files and images. Your current message has not been sent or changed.",
      trigger: trigger ?? plusTriggerRef.current ?? ref.current,
    });
    return false;
  };

  const triggerSubmit = () => {
    if (disabled || sendDisabled || submittingRef.current || isStreaming || pasteOffer) return;
    if (!online) return;
    if (!value.trim() && !validAttachmentInstruction) return;
    if ((attachments.length > 0 || selectedToolRef.current === "image") && !requireFileAccount())
      return;
    if (blockedAttachmentMessage) {
      setUploadAnnouncement(blockedAttachmentMessage);
      toast.error(blockedAttachmentMessage);
      return;
    }
    submittingRef.current = true;
    setUploadAnnouncement("Sending message…");
    try {
      const result = onSubmit(selectedToolRef.current);
      if (result && typeof result.then === "function")
        void result.then(
          () => {
            if (!streamingRef.current) submittingRef.current = false;
          },
          () => {
            submittingRef.current = false;
            setUploadAnnouncement("Message could not be sent. Your draft is still available.");
            toast.error("Message could not be sent. Please try again.");
          },
        );
    } catch {
      submittingRef.current = false;
      setUploadAnnouncement("Message could not be sent. Your draft is still available.");
      toast.error("Message could not be sent. Please try again.");
    }
  };

  const nextSubmittingRef = useRef(false);
  useEffect(() => {
    nextSubmittingRef.current = false;
  }, [sendNextDisabled, isStreaming, attachmentContext]);
  const triggerSendNext = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (
      !onSendNext ||
      !isStreaming ||
      sendNextDisabled ||
      nextSubmittingRef.current ||
      disabled ||
      pasteOffer ||
      !online
    )
      return;
    if (!value.trim() && !validAttachmentInstruction) return;
    if ((attachments.length > 0 || selectedToolRef.current === "image") && !requireFileAccount())
      return;
    if (blockedAttachmentMessage) {
      setUploadAnnouncement(blockedAttachmentMessage);
      return;
    }
    nextSubmittingRef.current = true;
    try {
      if (onSendNext(selectedToolRef.current, event?.currentTarget))
        setUploadAnnouncement(
          "Next message queued. You can cancel it before this response finishes.",
        );
      else nextSubmittingRef.current = false;
    } catch {
      nextSubmittingRef.current = false;
      setUploadAnnouncement("The next message was not queued. Your draft is still here.");
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    const shouldSubmit = shouldSubmitComposerOnEnter({
      key: e.key,
      keyCode: native.keyCode,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: Boolean(native.isComposing || composingRef.current),
      sendOnEnter: effectiveSendOnEnter,
      isMobileLayout,
      isCoarsePointer,
      hasContent: Boolean(value.trim() || validAttachmentInstruction),
      disabled,
      isStreaming,
    });
    if (!shouldSubmit || isMobileLayout) return;
    e.preventDefault();
    triggerSubmit();
  };

  async function addFiles(files: File[]): Promise<boolean> {
    if (disabled || !showAddMenu || files.length === 0) return false;
    if (!requireFileAccount()) return false;
    if (
      attachmentScopeRef.current !== attachmentAutoSave.scope ||
      attachmentContextRef.current.context !== attachmentContext
    )
      return false;
    if (uploadBatchRef.current) {
      toast.message("Wait for the current files to finish before adding more.");
      return false;
    }
    const readScope = attachmentAutoSave.scope;
    const readContext = attachmentContextRef.current;
    const currentRead = () =>
      attachmentScopeRef.current === readScope && attachmentContextRef.current === readContext;
    const availableSlots = Math.max(0, 2 - attachments.length);
    if (availableSlots === 0) {
      setUploadAnnouncement("Remove an attachment before adding another.");
      toast.error("You can attach up to 2 files per message.");
      return false;
    }
    if (files.length > availableSlots) {
      toast.message(
        `Only the first ${availableSlots} file${availableSlots === 1 ? "" : "s"} was added.`,
      );
    }
    uploadBatchRef.current = true;
    const acceptedIds = new Set<string>();
    try {
      let nextAttachments = [...composerStateRef.current.attachments];
      const seen = new Set(nextAttachments.map((a) => `${a.name}:${a.size ?? 0}`));

      for (const f of files.slice(0, availableSlots)) {
        const isImage = f.type.startsWith("image/");
        const isTextLike =
          f.type.startsWith("text/") || f.type === "application/json" || TEXT_LIKE_EXT.test(f.name);

        const isDocument = /\.(pdf|docx|xlsx|pptx)$/i.test(f.name);
        if (!isImage && !isTextLike && !isDocument) {
          const failed: PendingAttachment = {
            kind: "image",
            dataUrl: "",
            name: f.name,
            size: f.size,
            status: "failed",
            error: "Unsupported file type",
          };
          nextAttachments = [...nextAttachments, failed];
          setUploadAnnouncement(`${f.name}: unsupported file type`);
          continue;
        }

        const duplicateKey = `${f.name}:${f.size}`;
        if (seen.has(duplicateKey)) {
          setUploadAnnouncement(`${f.name} is already attached`);
          toast.message(`${f.name} is already attached.`);
          continue;
        }

        if (isImage) {
          if (f.size > MAX_IMAGE_FILE_BYTES) {
            nextAttachments = [
              ...nextAttachments,
              {
                kind: "image",
                dataUrl: "",
                name: f.name,
                size: f.size,
                status: "failed",
                error: "Image is larger than 3 MB",
              },
            ];
            setUploadAnnouncement(`${f.name}: image is larger than 3 MB`);
            continue;
          }
          const uploading: PendingAttachment = {
            clientId: crypto.randomUUID(),
            source: "file_upload",
            kind: "image",
            dataUrl: "",
            name: f.name,
            size: f.size,
            status: "uploading",
          };
          nextAttachments = [...nextAttachments, uploading];
          updateAttachments(nextAttachments);
          setUploadAnnouncement(`Reading ${f.name}`);
          try {
            const dataUrl = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(r.result as string);
              r.onerror = () => rej(new Error("Could not read image"));
              r.readAsDataURL(f);
            });
            if (!currentRead()) return false;
            nextAttachments = composerStateRef.current.attachments;
            if (!nextAttachments.some((item) => item.clientId === uploading.clientId)) continue;
            const completed: PendingAttachment = { ...uploading, dataUrl, status: "complete" };
            nextAttachments = nextAttachments.map((a) => (a === uploading ? completed : a));
            acceptedIds.add(completed.clientId!);
            void attachmentAutoSave.save(completed, readScope);
            seen.add(duplicateKey);
            setUploadAnnouncement(`${f.name} attached`);
          } catch (error) {
            if (!currentRead()) return false;
            nextAttachments = composerStateRef.current.attachments.map((a) =>
              a === uploading
                ? {
                    ...uploading,
                    status: "failed" as const,
                    error: error instanceof Error ? error.message : "Could not read image",
                  }
                : a,
            );
            setUploadAnnouncement(`${f.name}: upload failed`);
          }
          updateAttachments(nextAttachments);
        } else {
          if (f.size > (isDocument ? 10 * 1024 * 1024 : MAX_TEXT_FILE_BYTES)) {
            nextAttachments = [
              ...nextAttachments,
              {
                kind: "text_file",
                dataUrl: "",
                name: f.name,
                size: f.size,
                fileType: f.type || "text/plain",
                status: "failed",
                error: isDocument
                  ? "Document is larger than 10 MB"
                  : "Text file is larger than 256 KB",
              },
            ];
            setUploadAnnouncement(`${f.name}: text file is larger than 256 KB`);
            continue;
          }
          const uploading: PendingAttachment = {
            clientId: crypto.randomUUID(),
            source: "file_upload",
            kind: "text_file",
            dataUrl: "",
            name: f.name,
            size: f.size,
            fileType: f.type || "text/plain",
            status: "uploading",
          };
          nextAttachments = [...nextAttachments, uploading];
          updateAttachments(nextAttachments);
          setUploadAnnouncement(`Reading ${f.name}`);
          try {
            let textContent: string;
            let extractionNote = "";
            let pdf: PdfExtractionMetadata | undefined;
            if (isDocument) {
              const controller = new AbortController();
              documentReadsRef.current.add(controller);
              documentReadIdsRef.current.set(uploading.clientId!, controller);
              try {
                const { extractDocumentFile } = await import("@/lib/document-extraction/client");
                if (!currentRead()) return false;
                const result = await extractDocumentFile(f, controller.signal);
                if (controller.signal.aborted) return false;
                textContent = result.text;
                extractionNote = result.note;
                pdf = result.pdf;
              } finally {
                documentReadsRef.current.delete(controller);
                documentReadIdsRef.current.delete(uploading.clientId!);
              }
            } else textContent = await f.text();
            if (!currentRead()) return false;
            nextAttachments = composerStateRef.current.attachments;
            if (!nextAttachments.some((item) => item.clientId === uploading.clientId)) continue;
            const completed: PendingAttachment = {
              ...uploading,
              textContent,
              extractionNote: extractionNote || undefined,
              pdf,
              status: "complete",
              ...(isDocument
                ? {
                    name: `${f.name}.extracted.txt`,
                    fileType: "text/plain",
                    size: new TextEncoder().encode(textContent).length,
                  }
                : {}),
            };
            if (extractionNote) toast.message(extractionNote);

            nextAttachments = nextAttachments.map((attachment) =>
              attachment === uploading ? completed : attachment,
            );
            acceptedIds.add(completed.clientId!);
            void attachmentAutoSave.save(completed, readScope, isDocument ? f : undefined);
            seen.add(duplicateKey);
            setUploadAnnouncement(`${f.name} ready for analysis`);
          } catch (error) {
            if (!currentRead() || (error instanceof DOMException && error.name === "AbortError"))
              return false;
            nextAttachments = composerStateRef.current.attachments.map((attachment) =>
              attachment === uploading
                ? {
                    ...uploading,
                    status: "failed" as const,
                    error: error instanceof Error ? error.message : "Could not read file",
                    ...(error instanceof PdfTextUnavailableError ? { pdf: error.pdf } : {}),
                  }
                : attachment,
            );
            setUploadAnnouncement(`${f.name}: file could not be read`);
          }
          updateAttachments(nextAttachments);
        }
      }
      if (!currentRead()) return false;
      updateAttachments(nextAttachments);
      return composerStateRef.current.attachments.some(
        (item) => item.status === "complete" && !!item.clientId && acceptedIds.has(item.clientId),
      );
    } finally {
      uploadBatchRef.current = false;
    }
  }

  const removeAttachment = (index: number) => {
    const attachment = attachments[index];
    const id = attachment?.clientId;
    if (attachment?.localPaste) setRemovedPaste(attachment);
    if (id) documentReadIdsRef.current.get(id)?.abort();
    setUploadAnnouncement(`${attachments[index]?.name ?? "Attachment"} removed`);
    updateAttachments(attachments.filter((_, position) => position !== index));
    window.requestAnimationFrame(() => {
      if (attachment?.localPaste) undoPasteButtonRef.current?.focus();
      else ref.current?.focus();
    });
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await addFiles(files);
  };

  const attachLocalPaste = (paste: NonNullable<typeof pasteOffer>) => {
    // A compact local representation still requires an account and attachment validation.
    if (disabled || !showAddMenu || !requireFileAccount()) return false;
    const current = composerStateRef.current;
    if (current.attachments.some((attachment) => attachment.clientId === paste.id)) return true;
    if (current.attachments.length >= 2) {
      setPasteOffer({
        ...paste,
        error: "Two files are already attached. Remove one or paste this text into the message.",
      });
      return false;
    }
    // Local draft representation is not a successful upload. The existing server
    // save/send routes reserve the canonical upload identity and enforce the daily cap.
    updateAttachments([
      ...current.attachments,
      {
        clientId: paste.id,
        source: "file_upload",
        kind: "text_file",
        dataUrl: "",
        textContent: paste.text,
        localPaste: true,
        pasteOrigin: { original: paste.original, start: paste.start, end: paste.end },
        name: "pasted-text.txt",
        fileType: "text/plain",
        size: paste.size,
        status: "complete",
      },
    ]);
    setPasteOffer(null);
    setPastePreviewOpen(false);
    setRemovedPaste(null);
    setUploadAnnouncement(
      "Pasted text attached locally. Nothing has been uploaded. Inspect the chip to put it back into the message.",
    );
    return true;
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const generation = ++pasteGenerationRef.current;
    const files = Array.from(event.clipboardData.files || []);
    if (files.length === 0) {
      // Native short-text paste remains untouched. Plain text is canonical; rich HTML never changes it.
      const plain = event.clipboardData.getData("text/plain");
      if (disabled || !showAddMenu || plain.length <= LOCAL_PASTE_THRESHOLD) return;
      event.preventDefault();
      if (pasteOffer) {
        setUploadAnnouncement(
          "Finish with the existing pasted text before adding another large paste. The new text remains on your clipboard.",
        );
        return;
      }
      const target = event.target as HTMLTextAreaElement | undefined;
      const selectionTarget = target?.tagName === "TEXTAREA" ? target : ref.current;
      try {
        const prepared = prepareLocalPaste(plain);
        const paste = {
          ...prepared,
          id: crypto.randomUUID(),
          original: composerStateRef.current.value,
          start: selectionTarget?.selectionStart ?? value.length,
          end: selectionTarget?.selectionEnd ?? value.length,
        };
        if (generation !== pasteGenerationRef.current) return;
        setPasteOffer(paste);
        // Guests keep a local pending chip and can use Back to text without file permissions.
        if (fileAccountRef.current.isLoaded && fileAccountRef.current.userId)
          attachLocalPaste(paste);
        else
          setUploadAnnouncement(
            "Pasted text kept locally. Sign in to attach it, or put it back into the message.",
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Paste could not be prepared.";
        setUploadAnnouncement(message);
        toast.error(message);
      }
      return;
    }
    event.preventDefault();
    if (disabled || !showAddMenu) return;
    await addFiles(files);
  };

  const pasteIntoMessage = (attachment?: PendingAttachment) => {
    const text = attachment?.textContent ?? pasteOffer?.text;
    if (text === undefined || disabled) return;
    const current = composerStateRef.current;
    onChange(
      pasteAttachmentIntoDraft(
        current.value,
        text,
        attachment?.pasteOrigin ?? pasteOffer ?? undefined,
      ),
    );
    if (attachment) updateAttachments(current.attachments.filter((item) => item !== attachment));
    setPasteOffer(null);
    setPastePreviewOpen(false);
    setPreviewAttachment(null);
    setRemovedPaste(null);
    previewReturnToInputRef.current = true;
    setUploadAnnouncement("Exact pasted text restored to the message.");
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const undoPasteRemoval = () => {
    if (!removedPaste || disabled || composerStateRef.current.attachments.length >= 2) return;
    updateAttachments([...composerStateRef.current.attachments, removedPaste]);
    setRemovedPaste(null);
    setUploadAnnouncement("Pasted text attachment restored locally.");
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    if (disabled || !showAddMenu) return;
    await addFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!disabled && showAddMenu && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const attachLibraryFile = (item: RecentLibraryFile) => {
    if (disabled || isStreaming || !isLoaded || !user) return;
    const name = item.fileName || item.title;
    const duplicate = attachments.some((a) => a.libraryItemId === item.id);
    if (duplicate) {
      setUploadAnnouncement(`${name} is already attached`);
      toast.message(`${name} is already attached.`);
      return;
    }
    if (attachments.length >= 2) {
      setUploadAnnouncement("Remove an attachment before adding another.");
      toast.error("You can attach up to 2 files per message.");
      return;
    }
    updateAttachments([
      ...attachments,
      {
        kind: "library_file",
        dataUrl: "",
        name,
        size: item.fileSize ?? undefined,
        status: "complete",
        libraryItemId: item.id,
        fileType: item.fileType ?? null,
        sourceProject: item.projectName ?? null,
        createdAt: item.createdAt ?? null,
      },
    ]);
    setPlusOpen(false);
    setLibraryOpen(false);
    if (contextOpen) {
      contextReturnToInputRef.current = true;
      setContextOpen(false);
    }
    setUploadAnnouncement(`${name} attached from Library`);
    ref.current?.focus();
  };

  const visibleRecentLibraryFiles = recentLibraryFiles.filter((item) => {
    const q = recentQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (item.fileName || item.title).toLowerCase().includes(q) ||
      (item.fileType ?? "").toLowerCase().includes(q) ||
      (item.projectName ?? "").toLowerCase().includes(q)
    );
  });

  const renderRecentLibraryFiles = () => (
    <div className="kova-composer-library" aria-label="Saved Library files">
      {recentLibraryFiles.length > 0 ? (
        <label className="mx-2 mb-1 block">
          <span className="sr-only">Search Library files</span>
          <input
            value={recentQuery}
            onChange={(event) => setRecentQuery(event.target.value)}
            placeholder="Search files"
            className="h-10 w-full rounded-[var(--kova-radius-input)] border border-border bg-[var(--surface-input)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      ) : null}
      {recentLibraryLoading ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">Loading recent files…</div>
      ) : recentLibraryError ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          <div>{recentLibraryError}</div>
          {onRecentLibraryRetry ? (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-foreground underline"
              onClick={onRecentLibraryRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : visibleRecentLibraryFiles.length === 0 ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">
          No saved files yet. Files you save to your Library will appear here.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto p-1">
          {visibleRecentLibraryFiles.map((item) => {
            const name = item.fileName || item.title;
            return (
              <button
                data-kova-button-shape="preserve"
                key={item.id}
                type="button"
                disabled={disabled || isStreaming}
                onClick={() => attachLibraryFile(item)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[
                      item.fileType || "Library file",
                      item.projectName,
                      item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const selectedToolOption = COMPOSER_TOOLS.find((item) => item.id === selectedTool);
  const ActiveToolIcon = selectedToolOption?.icon;

  const chooseTool = (tool: ComposerAction) => {
    const next = selectedTool === tool.id ? null : tool.id;
    selectedToolRef.current = next;
    onToolSelect?.(next);
    setPlusOpen(false);
    setUploadAnnouncement(next ? `${tool.label} selected` : `${tool.label} removed`);
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const renderComposerActions = (
    mobile: boolean,
    section: "all" | "files" | "plugins" = "all",
    trigger: HTMLElement | null = plusTriggerRef.current,
  ) => {
    const closeActions = () => {
      setPlusOpen(false);
      setUtilityMenu(null);
    };
    const rowClass = "kova-composer-action";
    const pickFile = (input: React.RefObject<HTMLInputElement | null>) => {
      closeActions();
      if (!requireFileAccount(trigger)) return;
      input.current?.click();
    };
    const imageTool = COMPOSER_TOOLS.find((tool) => tool.id === "image")!;
    const openLibrary = () => {
      closeActions();
      if (!isLoaded) return;
      if (!user) {
        setSignInRequest({
          description:
            "Sign in to choose saved Library files or upload files from this device. Your current message is unchanged.",
          trigger,
        });
        return;
      }
      setLibraryOpen(true);
      onRecentLibraryRetry?.();
    };
    return (
      <>
        {mobile && section === "all" && (
          <div className="kova-composer-primary-actions" aria-label="Message preferences">
            <button type="button" className={rowClass} onClick={() => openMessageSettings(trigger)}>
              <Files aria-hidden="true" />
              Context
            </button>
            <button
              type="button"
              className={rowClass}
              onClick={() => {
                optionsReturnTriggerRef.current = trigger;
                optionsReturnUrlRef.current = window.location.href;
                closeActions();
                setOptionsOpen(true);
              }}
            >
              <SlidersHorizontal aria-hidden="true" />
              Response options
            </button>
          </div>
        )}
        {section !== "plugins" && (
          <p className="spec400-attachment-limits">
            Text and code: 256 KB. Images: 3 MB. PDF and Office: 10 MB.{" "}
            {Math.max(0, 2 - attachments.length)} of 2 message slots available.{" "}
            <ComposerUploadAllowance ownerId={isLoaded ? (user?.id ?? null) : null} />
          </p>
        )}
        {section !== "plugins" && (
          <div className="kova-composer-primary-actions" aria-label="Attachment options">
            {!mobile && (
              <button type="button" className={rowClass} disabled={!isLoaded} onClick={openLibrary}>
                <LibraryBig aria-hidden="true" />
                <span>Library</span>
              </button>
            )}
            {mobile && (
              <button type="button" className={rowClass} onClick={() => pickFile(photoRef)}>
                <ImageIcon aria-hidden="true" />
                <span>Photos</span>
              </button>
            )}
            {mobile && (
              <button type="button" className={rowClass} onClick={() => pickFile(cameraRef)}>
                <Camera aria-hidden="true" />
                <span>Camera</span>
              </button>
            )}
            <button type="button" className={rowClass} onClick={() => pickFile(fileRef)}>
              <Paperclip aria-hidden="true" />
              <span>{mobile ? "Files" : "Photos & Files"}</span>
            </button>
            {mobile && (
              <button type="button" className={rowClass} disabled={!isLoaded} onClick={openLibrary}>
                <LibraryBig aria-hidden="true" />
                <span>Library</span>
              </button>
            )}
            {(attachments.length > 0 || onOpenChatContext) && (
              <button
                type="button"
                className={rowClass}
                aria-haspopup="dialog"
                disabled={disabled || isStreaming}
                onClick={() => openMessageSettings(trigger)}
              >
                <Files aria-hidden="true" />
                <span>Context{attachments.length ? ` · ${attachments.length}` : ""}</span>
              </button>
            )}
            {showChooseProject && section === "all" && (
              <button
                ref={projectTriggerRef}
                type="button"
                className={rowClass}
                disabled={!isLoaded || disabled || isStreaming}
                onClick={() => {
                  closeActions();
                  projectReturnUrlRef.current = window.location.href;
                  if (!user) {
                    setSignInRequest({
                      description: "Sign in to open a project and use its instructions and files.",
                      trigger,
                    });
                    return;
                  }
                  setProjectPickerOpen(true);
                }}
              >
                <Folder aria-hidden="true" />
                <span>Open a project</span>
              </button>
            )}
            {section === "all" && (
              <button
                type="button"
                className={rowClass}
                disabled={!onToolSelect || disabled || isStreaming}
                aria-pressed={selectedTool === "web_search"}
                onClick={() => chooseTool(COMPOSER_TOOLS[0])}
              >
                <Globe aria-hidden="true" />
                <span>Search the web</span>
              </button>
            )}
            {!mobile && section === "all" && (
              <>
                <button
                  type="button"
                  className={rowClass}
                  onClick={() => {
                    closeActions();
                    if (!requireFileAccount(trigger)) return;
                    setDrawingOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  <span>Drawings</span>
                </button>
                <button
                  type="button"
                  className={rowClass}
                  aria-label="Create Image"
                  disabled={
                    !isLoaded || (Boolean(user) && !onToolSelect) || disabled || isStreaming
                  }
                  title={
                    !user
                      ? "Log in to create images"
                      : !onToolSelect
                        ? "Image creation is unavailable in this conversation"
                        : "Create an image in this chat"
                  }
                  onClick={() => {
                    if (!isLoaded || disabled || isStreaming) return;
                    if (!user) {
                      closeActions();
                      setSignInRequest({
                        description:
                          "Sign in to create images. Your current message has not been sent or changed.",
                        trigger,
                      });
                      return;
                    }
                    chooseTool(imageTool);
                  }}
                >
                  <ImagePlus aria-hidden="true" />
                  <span>
                    Create Image
                    {!user ? (
                      <small>Log in to create images</small>
                    ) : !onToolSelect ? (
                      <small>Unavailable in this conversation</small>
                    ) : null}
                  </span>
                </button>
              </>
            )}
          </div>
        )}
        {!mobile && section !== "files" && (
          <ComposerPluginList
            userId={isLoaded ? (user?.id ?? null) : null}
            authLoaded={isLoaded}
            conversations={user ? savedConversations : []}
            navigationBlocked={Boolean(
              value.length || attachments.length || isStreaming || disabled,
            )}
            onRequireSignIn={(pluginId) => {
              closeActions();
              setSignInRequest({
                description:
                  "Sign in to review this plugin’s connection and permissions. No plugin is connected automatically.",
                pluginId,
                trigger,
              });
            }}
            onNavigate={closeActions}
          />
        )}
      </>
    );
  };

  const openMessageSettings = (trigger: HTMLElement | null) => {
    contextTriggerRef.current = trigger;
    contextReturnToInputRef.current = false;
    contextSwitchingDialogRef.current = false;
    contextReturnUrlRef.current = window.location.href;
    setPlusOpen(false);
    setUtilityMenu(null);
    setContextOpen(true);
  };

  useEffect(() => {
    const openFromHeader = (event: Event) => {
      const detail = (event as CustomEvent<{ trigger?: HTMLElement }>).detail;
      contextTriggerRef.current = detail?.trigger ?? null;
      contextReturnToInputRef.current = false;
      contextSwitchingDialogRef.current = false;
      contextReturnUrlRef.current = window.location.href;
      setContextOpen(true);
    };
    window.addEventListener("kova-open-message-context", openFromHeader);
    return () => window.removeEventListener("kova-open-message-context", openFromHeader);
  }, []);

  const attachmentState = (attachment: PendingAttachment) =>
    attachment.status === "failed"
      ? attachment.pdf && !attachment.pdf.pages.some((page) => page.status === "failed")
        ? "No extractable text"
        : "Failed"
      : attachment.status === "uploading"
        ? "Processing"
        : attachment.kind === "library_file"
          ? "Reference selected · checked when sent"
          : attachment.status === "complete"
            ? attachment.pdf?.pages.some((page) => page.status === "failed")
              ? "Partial text · inspect page results"
              : "Ready"
            : "Queued";
  const canSubmit =
    !pasteOffer &&
    !disabled &&
    !sendDisabled &&
    online &&
    Boolean(value.trim() || validAttachmentInstruction) &&
    !blockedAttachmentMessage;

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]"),
    );
    if (!controls.length) return;
    event.preventDefault();
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? controls.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
  };

  const updatePdfSelection = (input: string | null): string | undefined => {
    const current = composerStateRef.current.attachments.find((item) => item === previewAttachment);
    if (disabled || !isLoaded || !user || !current?.pdf || current.status !== "complete")
      return "This attachment is no longer available for page selection.";
    try {
      const selection = input === null ? undefined : selectPdfPages(current.pdf, input);
      const textContent = selection?.text ?? pdfDocumentText(current.pdf);
      const updated: PendingAttachment = {
        ...current,
        textContent,
        size: new TextEncoder().encode(textContent).length,
        selectedPdfPages: selection?.pageNumbers,
      };
      updateAttachments(
        composerStateRef.current.attachments.map((item) => (item === current ? updated : item)),
      );
      setPreviewAttachment(updated);
      setPreviewOffset(0);
      setUploadAnnouncement(
        selection
          ? `${current.name}: extracted text from pages ${formatPdfPageNumbers(selection.pageNumbers)} selected.`
          : `${current.name}: full extracted text restored.`,
      );
    } catch (error) {
      return error instanceof Error ? error.message : "Could not select PDF text pages.";
    }
  };
  const previewPdfWithoutMetadata =
    previewAttachment &&
    !previewAttachment.pdf &&
    (previewAttachment.fileType === "application/pdf" ||
      /\.pdf(?:\.extracted\.txt)?$/iu.test(previewAttachment.name));

  const previewText = pastePreviewOpen ? pasteOffer?.text : previewAttachment?.textContent;
  const textWindow =
    previewText === undefined ? null : attachmentPreviewWindow(previewText, previewOffset);
  const hasDraft = Boolean(value.trim() || attachments.length || pasteOffer);

  return (
    <div
      className="spec400-chat-input"
      data-composer-surface={surface}
      data-signed-in={isLoaded && user ? "true" : undefined}
      style={isMobileLayout && kbOffset > 0 ? { paddingBottom: `${kbOffset + 8}px` } : undefined}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {typeof requestStatusPanel === "function"
        ? requestStatusPanel(Boolean(value.length || attachments.length || pasteOffer))
        : requestStatusPanel}
      {!online && (
        <p role="status" className="spec400-connection-status">
          Offline. Your draft is preserved. Reconnect to send.
        </p>
      )}
      <div
        className="spec400-composer"
        data-ui-reference="chatgpt-composer"
        data-has-draft={hasDraft ? "true" : "false"}
        data-focus-origin={composerFocusOrigin}
        onPointerDownCapture={() => setComposerFocusOrigin("pointer")}
        onKeyDownCapture={(event) => {
          if (event.key === "Tab") setComposerFocusOrigin("keyboard");
        }}
      >
        {(attachments.length > 0 || pasteOffer) && (
          <ul className="spec400-attachment-chips" aria-label="Attachments">
            {attachments.map((attachment, index) => (
              <li
                key={attachment.clientId ?? `${attachment.name}:${index}`}
                className="spec400-attachment-chip"
                data-status={attachment.status}
              >
                <button
                  type="button"
                  className="spec400-chip-inspect"
                  aria-label={`Inspect ${attachment.name}`}
                  title={`${attachment.name} · ${attachmentState(attachment)}`}
                  onClick={(event) => {
                    previewTriggerRef.current = event.currentTarget;
                    previewReturnToInputRef.current = false;
                    setPreviewOffset(0);
                    setPreviewAttachment(attachment);
                  }}
                >
                  {attachment.status === "uploading" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : attachment.status === "failed" ? (
                    <AlertCircle aria-hidden="true" />
                  ) : attachment.kind === "image" ? (
                    <ImageIcon aria-hidden="true" />
                  ) : (
                    <FileText aria-hidden="true" />
                  )}
                  <span className="spec400-chip-name">{attachment.name}</span>
                  <span className="sr-only">{attachmentState(attachment)}</span>
                  {attachment.localPaste && <small>Local</small>}
                  {attachment.pdf && (
                    <small>
                      {attachment.pdf.pageCount} {attachment.pdf.pageCount === 1 ? "page" : "pages"}
                      {attachment.status === "complete" &&
                      attachment.pdf.pages.some((page) => page.status === "failed")
                        ? " · partial text"
                        : ""}
                    </small>
                  )}
                  {attachment.selectedPdfPages && (
                    <small>Selected: {formatPdfPageNumbers(attachment.selectedPdfPages)}</small>
                  )}
                </button>
                <button
                  type="button"
                  className="spec400-chip-remove"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => removeAttachment(index)}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
            {pasteOffer && (
              <li className="spec400-attachment-chip" data-status="pending">
                <button
                  type="button"
                  className="spec400-chip-inspect"
                  aria-label="Inspect pending pasted text"
                  onClick={(event) => {
                    previewTriggerRef.current = event.currentTarget;
                    previewReturnToInputRef.current = false;
                    setPreviewOffset(0);
                    setPastePreviewOpen(true);
                  }}
                >
                  <FileText aria-hidden="true" />
                  <span className="spec400-chip-name">pasted-text.txt</span>
                  <small>Not attached</small>
                </button>
                <button
                  type="button"
                  className="spec400-chip-remove"
                  aria-label="Remove pending pasted text"
                  onClick={() => {
                    setPasteOffer(null);
                    setPastePreviewOpen(false);
                    window.requestAnimationFrame(() => ref.current?.focus());
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            )}
          </ul>
        )}
        <div className="spec400-input-region">
          <textarea
            ref={ref}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            onKeyDown={handleKey}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder={placeholder ?? "Describe what you need…"}
            rows={1}
            spellCheck
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            enterKeyHint={
              effectiveSendOnEnter && !isMobileLayout && !isCoarsePointer ? "send" : "enter"
            }
            className="spec400-composer-input"
            aria-label="Message KovaGPT"
            aria-keyshortcuts={
              isMobileLayout
                ? undefined
                : effectiveSendOnEnter
                  ? "Enter Control+Enter Meta+Enter"
                  : "Control+Enter Meta+Enter"
            }
          />
          <button
            ref={expandTriggerRef}
            type="button"
            className="spec400-expand-input"
            aria-label="Expand input"
            title="Expand input"
            disabled={disabled}
            onClick={() => setExpanded(true)}
          >
            <Maximize2 aria-hidden="true" />
          </button>
        </div>
        {showAddMenu && selectedToolOption && ActiveToolIcon && onToolSelect && (
          <button
            type="button"
            className="spec400-selected-tool"
            disabled={disabled || isStreaming}
            onClick={() => chooseTool(selectedToolOption)}
            aria-label={`Remove ${selectedToolOption.label}`}
          >
            <ActiveToolIcon aria-hidden="true" />
            {selectedToolOption.label}
            <X aria-hidden="true" />
          </button>
        )}
        <div aria-live="polite" className="sr-only">
          {uploadAnnouncement}
        </div>
        <div className="spec400-composer-toolbar" role="group" aria-label="Message tools">
          <div className="spec400-composer-tools">
            <input
              ref={fileRef}
              aria-label="Choose files"
              disabled={disabled || isStreaming || !isLoaded || !user}
              type="file"
              accept="image/*,text/*,.pdf,.docx,.xlsx,.pptx,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
              multiple
              hidden
              onChange={onFileChange}
            />
            <input
              ref={photoRef}
              aria-label="Choose photos"
              disabled={disabled || isStreaming || !isLoaded || !user}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onFileChange}
            />
            <input
              ref={cameraRef}
              aria-label="Take a photo"
              disabled={disabled || isStreaming || !isLoaded || !user}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={onFileChange}
            />
            {showAddMenu && (
              <Popover open={plusOpen && !isMobileLayout} onOpenChange={setPlusOpen}>
                <PopoverTrigger asChild>
                  <button
                    ref={plusTriggerRef}
                    type="button"
                    disabled={disabled || isStreaming}
                    className="spec400-toolbar-button spec400-toolbar-icon"
                    aria-label="Attach"
                    title="Add files and tools"
                    aria-haspopup="dialog"
                    aria-expanded={plusOpen}
                    onClick={isMobileLayout ? () => setPlusOpen(true) : undefined}
                  >
                    <Plus aria-hidden="true" />
                    <span className="sr-only">Attach</span>
                  </button>
                </PopoverTrigger>
                {!isMobileLayout && (
                  <PopoverContent
                    role="dialog"
                    aria-label="Attach files and tools"
                    className="kova-composer-menu spec400-attach-menu"
                    side="top"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    onKeyDown={handleMenuKeyDown}
                    onCloseAutoFocus={(event) => {
                      if (
                        libraryOpen ||
                        drawingOpen ||
                        signInRequest ||
                        contextOpen ||
                        projectPickerOpen
                      )
                        event.preventDefault();
                    }}
                  >
                    {renderComposerActions(false)}
                  </PopoverContent>
                )}
              </Popover>
            )}
            {(showAddMenu || readOnlyContext) && (
              <button
                type="button"
                className="spec400-toolbar-button spec400-toolbar-icon"
                aria-label="Context"
                title="Files, instructions, and saved material"
                aria-haspopup="dialog"
                aria-expanded={contextOpen}
                disabled={disabled && !readOnlyContext}
                onClick={(event) => openMessageSettings(event.currentTarget)}
              >
                <Files aria-hidden="true" />
                <span className="sr-only">Context</span>
                {attachments.length > 0 && (
                  <span className="spec400-context-count">{attachments.length}</span>
                )}
              </button>
            )}
            <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
              {optionsReturnTriggerRef.current ? (
                <PopoverAnchor virtualRef={plusTriggerRef} />
              ) : null}
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="spec400-toolbar-button spec400-toolbar-icon"
                  disabled={disabled}
                  aria-label="Options"
                  title="Response format, length, and tone"
                  aria-haspopup="dialog"
                  aria-expanded={optionsOpen}
                  onClick={() => {
                    optionsReturnTriggerRef.current = null;
                  }}
                >
                  <SlidersHorizontal aria-hidden="true" />
                  <span className="sr-only">Options</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                role="dialog"
                aria-label="Response options"
                className="spec400-options-panel"
                onCloseAutoFocus={(event) => {
                  if (!optionsReturnTriggerRef.current) return;
                  event.preventDefault();
                  restoreDialogFocus(optionsReturnTriggerRef.current, optionsReturnUrlRef.current);
                  optionsReturnTriggerRef.current = null;
                }}
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={12}
              >
                <h2>Response options</h2>
                <p>
                  Preferences guide replies. Explicit instructions in your message take priority.
                </p>
                {responseSettings && onResponseSettingsChange ? (
                  <>
                    <label>
                      Format
                      <Select
                        value={responseSettings.responseFormat ?? "automatic"}
                        onValueChange={(value) =>
                          onResponseSettingsChange({
                            responseFormat: value as Settings["responseFormat"],
                          })
                        }
                      >
                        <SelectTrigger aria-label="Format" className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="automatic">Automatic</SelectItem>
                          <SelectItem value="plain">Plain text</SelectItem>
                          <SelectItem value="markdown">Markdown</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label>
                      Length
                      <Select
                        value={responseSettings.responseLength}
                        onValueChange={(value) =>
                          onResponseSettingsChange({
                            responseLength: value as Settings["responseLength"],
                          })
                        }
                      >
                        <SelectTrigger aria-label="Length" className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Concise</SelectItem>
                          <SelectItem value="medium">Standard</SelectItem>
                          <SelectItem value="long">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label>
                      Tone
                      <Select
                        value={responseSettings.responseTone ?? "direct"}
                        onValueChange={(value) =>
                          onResponseSettingsChange({
                            responseTone: value as Settings["responseTone"],
                          })
                        }
                      >
                        <SelectTrigger aria-label="Tone" className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="direct">Direct</SelectItem>
                          <SelectItem value="formal">Formal</SelectItem>
                          <SelectItem value="conversational">Conversational</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <p>
                      {responseSettings.responseTone === "formal"
                        ? "Use polished, professional language."
                        : responseSettings.responseTone === "conversational"
                          ? "Use a natural, friendly style."
                          : "Get to the point with clear, straightforward language."}
                    </p>
                  </>
                ) : (
                  <p>Format, length, and tone preferences are available in Settings → Responses.</p>
                )}
                <p>Choose your model from the bottom of the message box.</p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="spec400-composer-trailing">
            {canChangeAgent && mode && onModeChange ? (
              <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
            ) : (
              <ComposerModelStatus visible={showModelStatus && isLoaded && Boolean(user)} />
            )}
            <button
              type="button"
              data-testid="dictate-button"
              className="spec400-toolbar-button spec400-toolbar-icon"
              aria-label="Dictate"
              aria-haspopup="dialog"
              aria-expanded={activeVoiceMode === "dictate"}
              disabled={disabled || isStreaming || !isLoaded || !online}
              title="Dictate into an editable message draft"
              onClick={(event) => openVoice("dictate", event.currentTarget)}
            >
              <Mic aria-hidden="true" />
              <span className="sr-only">Dictate</span>
            </button>
            <button
              type="button"
              data-testid="voice-button"
              className="spec400-send-button spec400-primary-voice"
              hidden={hasDraft || isStreaming}
              aria-label="Voice"
              aria-haspopup="dialog"
              aria-expanded={activeVoiceMode === "voice"}
              disabled={
                disabled ||
                isStreaming ||
                !isLoaded ||
                !user ||
                !online ||
                !onVoiceSubmit ||
                voiceOpeningBlocked
              }
              title={
                onVoiceSubmit
                  ? "Start a voice conversation"
                  : "Voice conversations require a saved chat"
              }
              onClick={(event) => openVoice("voice", event.currentTarget)}
            >
              <AudioLines aria-hidden="true" />
              <span className="sr-only">Voice</span>
            </button>
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="spec400-send-button"
                aria-label="Stop generating"
                data-testid="stop-button"
              >
                <Square aria-hidden="true" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={triggerSubmit}
                className="spec400-send-button"
                hidden={!hasDraft}
                aria-label="Send message"
                data-testid="send-button"
                title={
                  disabled
                    ? "Messaging is unavailable"
                    : sendDisabled
                      ? "Getting this chat ready…"
                      : (blockedAttachmentMessage ??
                        (!online ? "Reconnect to send" : "Send message"))
                }
              >
                <ArrowUp aria-hidden="true" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {pasteOffer && (
        <p className="spec400-composer-hint" role="status">
          {pasteOffer.error ??
            "Pasted text is local and not attached yet. Inspect the chip to attach it or put it back into the message."}
          <button type="button" className="spec400-paste-back" onClick={() => pasteIntoMessage()}>
            Back to text
          </button>
        </p>
      )}
      {removedPaste && (
        <p className="spec400-composer-hint" role="status">
          Pasted text removed.
          <button
            type="button"
            className="spec400-paste-back"
            disabled={disabled || attachments.length >= 2}
            ref={undoPasteButtonRef}
            onClick={undoPasteRemoval}
          >
            Undo removal
          </button>
        </p>
      )}
      {blockedAttachmentMessage && (
        <p className="spec400-composer-hint" role="status">
          {blockedAttachmentMessage}
        </p>
      )}
      <ComposerVoiceDialog
        open={activeVoiceMode !== null}
        mode={activeVoiceMode ?? "dictate"}
        onOpenChange={(open) => {
          if (!open && voiceMountedRef.current && voiceIdentityRef.current === voiceScope)
            setVoiceOpenMode(null);
        }}
        userId={isLoaded ? (user?.id ?? null) : null}
        contextKey={voiceContextKey}
        disabled={disabled || !online}
        isStreaming={isStreaming}
        latestAssistantText={latestAssistantText}
        latestAssistantReply={latestAssistantReply}
        conversationModelControl={
          <ComposerModelStatus visible={showModelStatus && isLoaded && Boolean(user)} />
        }
        onTranscript={acceptVoiceTranscript}
        onVoiceSubmit={onVoiceSubmit ? submitVoiceTranscript : undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            !voiceMountedRef.current ||
            voiceIdentityRef.current !== voiceScope ||
            voiceCallbacksRef.current.disabled
          )
            return;
          const invoker = voiceTriggerRef.current;
          restoreDialogFocus(
            voiceDraftAppliedRef.current || invoker?.hidden
              ? ref.current
              : (invoker ?? ref.current),
            voiceReturnUrlRef.current,
          );
        }}
      />
      {isStreaming && onSendNext && (
        <div className="flex justify-end px-3 pb-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            aria-label="Send next"
            data-testid="send-next-button"
            disabled={!canSubmit || sendNextDisabled}
            onClick={triggerSendNext}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            <span>Send next</span>
          </button>
        </div>
      )}
      {nextPromptPanel}
      {isStreaming && value.trim() && !nextPromptPanel && (
        <p className="spec400-composer-hint">
          {onSendNext
            ? "Your next draft is kept here. Choose Send next to send this version after the response finishes."
            : "Your next draft is kept here. Send it when this response finishes."}
        </p>
      )}
      {showAddMenu && isMobileLayout && (
        <MobileBottomSheet
          open={plusOpen}
          onOpenChange={setPlusOpen}
          title="Attach"
          ariaLabel="Attach files and tools"
          restoreFocus={!contextOpen && !libraryOpen && !signInRequest && !optionsOpen}
        >
          <div className="spec400-attach-menu">{renderComposerActions(true)}</div>
        </MobileBottomSheet>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="spec400-expanded-input"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            expandTriggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Expand input</DialogTitle>
            <DialogDescription>
              Edit the same draft. Closing this editor keeps your changes.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="expanded-message" className="spec400-field-label">
            Message
          </label>
          <textarea
            id="expanded-message"
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="spec400-expanded-textarea"
            placeholder="Describe what you need…"
            disabled={disabled}
          />
          {(attachments.length > 0 || pasteOffer) && (
            <p className="spec400-composer-hint" role="status">
              {attachments.length + (pasteOffer ? 1 : 0)} attachment
              {attachments.length + (pasteOffer ? 1 : 0) === 1 ? "" : "s"}. Collapse input to
              inspect or remove them.
            </p>
          )}
          <div className="spec400-dialog-footer">
            <button
              type="button"
              className="spec400-toolbar-button"
              onClick={() => setExpanded(false)}
            >
              Collapse input
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={previewAttachment !== null || pastePreviewOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
            setPastePreviewOpen(false);
            setPreviewOffset(0);
          }
        }}
      >
        <DialogContent
          className="spec400-attachment-preview"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previewReturnToInputRef.current || !previewTriggerRef.current?.isConnected)
              ref.current?.focus({ preventScroll: true });
            else previewTriggerRef.current?.focus({ preventScroll: true });
            previewReturnToInputRef.current = false;
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pastePreviewOpen ? "pasted-text.txt" : previewAttachment?.name}
            </DialogTitle>
            <DialogDescription>
              {pastePreviewOpen
                ? "Kept locally. Not attached or uploaded. Reloading discards this pasted text."
                : previewAttachment?.localPaste
                  ? "Exact clipboard text. Kept locally until you send. Reloading discards this pasted text."
                  : previewAttachment
                    ? attachmentState(previewAttachment)
                    : "Attachment"}
            </DialogDescription>
          </DialogHeader>
          {previewAttachment?.pdf && (
            <ComposerPdfPages
              key={previewAttachment.clientId ?? previewAttachment.name}
              pdf={previewAttachment.pdf}
              selectedPages={previewAttachment.selectedPdfPages}
              disabled={disabled || !isLoaded || !user || previewAttachment.status !== "complete"}
              onSelect={updatePdfSelection}
            />
          )}
          {previewPdfWithoutMetadata && (
            <p>
              Page count, page selection and page-read results are unavailable for this attachment.
              Saved text-only records do not retain PDF page metadata. Attach the original PDF again
              to inspect its pages.
            </p>
          )}
          {previewAttachment?.kind === "image" && previewAttachment.dataUrl ? (
            <img
              src={previewAttachment.dataUrl}
              alt={previewAttachment.name}
              loading="lazy"
              decoding="async"
            />
          ) : textWindow ? (
            <>
              <p className="spec400-preview-range">
                Characters {textWindow.start + 1}–{textWindow.end} of{" "}
                {textWindow.total.toLocaleString()}.{" "}
                {pastePreviewOpen
                  ? "The full text is kept locally."
                  : previewAttachment?.selectedPdfPages
                    ? "Only the selected pages’ extracted text is attached; the full extraction is kept locally for Restore."
                    : "The full text remains attached."}
              </p>
              <pre className="spec400-bounded-preview" tabIndex={0}>
                {textWindow.text}
              </pre>
              {textWindow.total > 4_000 && (
                <div className="spec400-preview-pages" role="group" aria-label="Text preview pages">
                  <button
                    type="button"
                    className="spec400-toolbar-button"
                    disabled={textWindow.start === 0}
                    onClick={() => setPreviewOffset(Math.max(0, textWindow.start - 4_000))}
                  >
                    Previous text
                  </button>
                  <button
                    type="button"
                    className="spec400-toolbar-button"
                    disabled={textWindow.end >= textWindow.total}
                    onClick={() => setPreviewOffset(textWindow.end)}
                  >
                    Next text
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>
              {previewAttachment?.error ??
                "This saved reference is checked for readability when you send. The full file is available in Library."}
            </p>
          )}
          {previewAttachment?.extractionNote && <p>{previewAttachment.extractionNote}</p>}
          {(pastePreviewOpen || previewAttachment?.localPaste) && (
            <div className="spec400-dialog-footer">
              <button
                type="button"
                className="spec400-toolbar-button"
                onClick={() => pasteIntoMessage(previewAttachment ?? undefined)}
              >
                Back to text
              </button>
              {pastePreviewOpen && pasteOffer && (
                <button
                  type="button"
                  className="spec400-toolbar-button"
                  disabled={disabled || !isLoaded || attachments.length >= 2}
                  onClick={() => attachLocalPaste(pasteOffer)}
                >
                  Attach text
                </button>
              )}
            </div>
          )}
          {previewAttachment?.status === "failed" && (
            <button
              type="button"
              className="spec400-toolbar-button"
              onClick={() => {
                const index = attachments.indexOf(previewAttachment);
                if (index >= 0) removeAttachment(index);
                setPreviewAttachment(null);
                fileRef.current?.click();
              }}
            >
              Choose file again
            </button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent
          className="sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            ref.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add from Library</DialogTitle>
            <DialogDescription>
              {user
                ? "Choose a saved file to use in this conversation."
                : "Log in to access your saved files and images."}
            </DialogDescription>
          </DialogHeader>
          {user && onRecentLibraryRetry ? (
            <button
              type="button"
              className="kova-library-refresh"
              onClick={onRecentLibraryRetry}
              disabled={recentLibraryLoading}
            >
              Refresh Library
            </button>
          ) : null}
          {user ? (
            renderRecentLibraryFiles()
          ) : (
            <SignInButton mode="modal">
              <button type="button" className="kova-library-sign-in">
                Log in
              </button>
            </SignInButton>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent
          className="spec400-context-drawer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = contextReturnToInputRef.current
              ? ref.current
              : contextTriggerRef.current;
            restoreDialogFocus(
              target,
              contextReturnUrlRef.current,
              contextSwitchingDialogRef.current,
            );
            contextReturnToInputRef.current = false;
          }}
        >
          <DialogHeader>
            <DialogTitle>{readOnlyContext?.title ?? "Context"}</DialogTitle>
            <DialogDescription>
              {readOnlyContext?.description ??
                "Inspect the material included with your next message."}
            </DialogDescription>
          </DialogHeader>
          {readOnlyContext ? (
            readOnlyContext.content
          ) : (
            <ComposerContextPanel
              attachments={attachments}
              selectedTool={selectedToolOption?.label}
              disabled={disabled || isStreaming}
              onRemove={removeAttachment}
              onInspect={(index) => {
                previewTriggerRef.current = document.activeElement as HTMLElement;
                setPreviewOffset(0);
                previewReturnToInputRef.current = false;
                setPreviewAttachment(attachments[index]);
              }}
              chatRulesActive={chatRulesActive}
              onOpenChatContext={
                onOpenChatContext
                  ? () => {
                      contextSwitchingDialogRef.current = true;
                      setContextOpen(false);
                      onOpenChatContext(contextTriggerRef.current);
                    }
                  : undefined
              }
              library={
                user ? (
                  renderRecentLibraryFiles()
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sign in to choose saved Library files or upload files from this device.
                  </p>
                )
              }
            />
          )}
          <button
            type="button"
            className="spec400-toolbar-button spec400-context-close"
            onClick={() => setContextOpen(false)}
          >
            Close Context
          </button>
        </DialogContent>
      </Dialog>
      <ComposerDrawingDialog
        open={drawingOpen}
        onOpenChange={setDrawingOpen}
        onAttach={addFiles}
        onReturnFocus={() => ref.current?.focus()}
      />
      {signInRequest ? (
        <Suspense fallback={null}>
          <ComposerSignInDialog
            description={signInRequest.description}
            onClose={() => setSignInRequest(null)}
            returnFocusTarget={signInRequest.trigger}
            hasPendingMessage={Boolean(value.length || attachments.length || pasteOffer)}
          />
        </Suspense>
      ) : null}
      {projectPickerOpen ? (
        <Suspense fallback={null}>
          <ComposerProjectPicker
            open
            onOpenChange={setProjectPickerOpen}
            navigationBlocked={Boolean(
              value.length || attachments.length || isStreaming || disabled,
            )}
            navigationBlockedReason="Send or clear this message and its attachments before opening a project. Your current chat will not be moved."
            returnFocusTarget={projectTriggerRef.current}
            returnFocusUrl={projectReturnUrlRef.current}
          />
        </Suspense>
      ) : null}
      {surface !== "empty" && (
        <p className="spec400-composer-disclaimer mt-2 text-center text-[11px] text-muted-foreground">
          KovaGPT can make mistakes. Check important information.
        </p>
      )}
    </div>
  );
}
