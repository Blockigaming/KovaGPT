import { ChatOutputTemplates } from "./ChatOutputTemplates";
import { chatOutputPrompt, type ChatOutputFormat } from "@/lib/chat-output-templates";
import { Grid2X2, List as ListIcon, Settings as SettingsIcon } from "lucide-react";
import {
  AttachmentPreviewAsk,
  AttachmentPreviewFileInfo,
  AttachmentPreviewMobileHeader,
} from "./AttachmentPreviewMobile";
import { copyChatImage, downloadChatImage, shareChatImage } from "@/lib/chat-image-actions";
import { ConsumerModelSelector } from "@/components/ConsumerModelSelector";
import {
  CONSUMER_MODELS,
  consumerModel,
  type ConsumerModelId,
} from "@/lib/consumer-model-selection.mjs";
import {
  ArrowUp,
  Brain,
  AudioLines,
  Mic,
  Paperclip,
  Plug,
  Plus,
  Square,
  X,
  Image as ImageIcon,
  ImagePlus,
  Globe,
  FileText,
  Camera,
  BookOpen,
  Boxes,
  ChevronRight,
  MessageSquare,
  Search,
  LibraryBig,
  Pencil,
  Folder,
  AlertCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { ExpandViewIcon } from "@/components/ui/ExpandViewIcon";

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
import type { ComposerVoiceSubmit, ComposerVoiceTurn } from "@/lib/composer-voice-turn";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useLibraryAttachmentAutoSave } from "@/hooks/use-library-attachment-auto-save";
import { useLayout } from "@/hooks/use-mobile";
import { composerKeyboardInset } from "@/lib/composer-keyboard-inset.mjs";
import { useSharedSendOnEnter } from "@/lib/composer-preferences";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  useImperativeHandle,
  type Ref,
} from "react";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import { modesForTier, type ModeId, type Tier } from "@/lib/modes";
import { shouldSubmitComposerOnEnter } from "@/lib/composer-keyboard.mjs";
import type { ComposerToolId, Conversation } from "@/lib/chat-store";

import { Link } from "@tanstack/react-router";
import { HelpSupportForm } from "@/components/HelpSupportForm";
import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { OpenDesktopAppButton } from "@/components/OpenDesktopAppButton";
import { ComposerDrawingDialog } from "@/components/ComposerDrawingDialog";
import { ComposerPluginList, useComposerPluginConnections } from "@/components/ComposerPluginList";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
import { LinkPreviewChip } from "@/components/LinkPreviewChip";
import {
  COMPOSER_LINK_MARKER,
  firstLinkPreviewToken,
  fromComposerLinkDisplay,
  toComposerLinkDisplay,
} from "@/lib/link-preview.mjs";
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
  pasteSummary?: string;
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
  { id: "study", label: "Study", icon: BookOpen },
  { id: "data_analysis", label: "Analyze data", icon: Brain },
  { id: "file_analysis", label: "Analyze files", icon: FileText },
];

const SLASH_COMMANDS = [
  { id: "dictate", label: "Dictate", description: "Convert speech to text", icon: Mic },
  {
    id: "feedback",
    label: "Feedback",
    description: "Send feedback about this chat",
    icon: MessageSquare,
  },
  { id: "model", label: "Model", description: "Change your model", icon: Boxes, submenu: true },
  { id: "study", label: "Study", description: "Learn a new concept", icon: BookOpen },
  {
    id: "project",
    label: "Work in a project",
    description: "Start a chat in a project",
    icon: Folder,
    submenu: true,
  },
] as const;
type SlashCommand = (typeof SLASH_COMMANDS)[number]["id"];

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

export type ChatActivityComposer = {
  addFiles: (trigger: HTMLElement | null) => void;
  openLibrary: (trigger: HTMLElement | null) => void;
  openTemplates: (format: ChatOutputFormat) => void;
};

export function ChatInput({
  activityComposerRef,
  value,
  onChange,
  onSubmit,
  onAskAttachment,
  onStop,
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
  hostedModel,
  onHostedModelChange,
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
  projectContext,
  onProjectContext,
  pluginContexts = [],
  onPluginContextsChange,
  showResources = true,
  savedConversations = [],
  surface = "conversation",
  viewportManaged = false,
  attachmentContext,
  latestAssistantText = "",
  latestAssistantReply,
  voiceMode,
  onVoiceModeChange,
  onVoiceSubmit,
}: {
  activityComposerRef?: Ref<ChatActivityComposer>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (tool?: ComposerToolId | null) => void | Promise<unknown>;
  onAskAttachment?: (prompt: string, attachment: PendingAttachment) => boolean;
  onStop: () => void;
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
  hostedModel?: ConsumerModelId;
  onHostedModelChange?: (model: ConsumerModelId) => void;
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
  projectContext?: { id: string; name: string } | null;
  onProjectContext?: (project: { id: string; name: string } | null) => void;
  pluginContexts?: readonly { id: string; label: string }[];
  onPluginContextsChange?: (plugins: { id: string; label: string }[]) => void;
  /** The welcome tray disappears once a conversation has messages. */
  showResources?: boolean;
  savedConversations?: readonly Conversation[];
  /** Controls whether the desktop add menu opens below the centered composer or above a docked one. */
  surface?: "empty" | "conversation";
  viewportManaged?: boolean;
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
  onVoiceSubmit?: ComposerVoiceSubmit;
  responseSettings?: Pick<Settings, "responseLength" | "responseFormat" | "responseTone">;
  onResponseSettingsChange?: (
    change: Partial<Pick<Settings, "responseLength" | "responseFormat" | "responseTone">>,
  ) => void;
}) {
  const { isDesktop, isTablet, interaction } = useLayout();
  const { user, isLoaded } = useUser();
  const fileAccountRef = useRef({ isLoaded, userId: user?.id ?? null });
  fileAccountRef.current = { isLoaded, userId: user?.id ?? null };
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
    summary: string;
    original: string;
    start: number;
    end: number;
    size: number;
    error?: string;
  } | null>(null);
  const [atomicLinkRaw, setAtomicLinkRaw] = useState<string | null>(null);
  // Only the rendered composer collapses the URL. State, history and model
  // requests retain the exact original characters.
  const draftLinkToken = firstLinkPreviewToken(value);
  const activeAtomicLink = draftLinkToken?.raw === atomicLinkRaw ? atomicLinkRaw : null;
  const visibleComposerValue = activeAtomicLink
    ? toComposerLinkDisplay(value, activeAtomicLink)
    : value;
  const composerStateRef = useRef({ value, attachments });
  composerStateRef.current = { value, attachments };
  const updateAttachments = (next: PendingAttachment[]) => {
    composerStateRef.current.attachments = next;
    onAttachmentsChange(next);
  };
  const uploadBatchRef = useRef(false);
  useEffect(() => {
    setPasteOffer(null);
    setAtomicLinkRaw(null);
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
  const [longDraft, setLongDraft] = useState(false);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashModels, setSlashModels] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const slashListRef = useRef<HTMLDivElement>(null);
  const dictationTriggerRef = useRef<HTMLButtonElement>(null);
  const slashQuery = /^\/([a-z-]*)$/iu.exec(value)?.[1]?.toLowerCase();
  const slashMatches =
    slashQuery === undefined
      ? []
      : SLASH_COMMANDS.filter(
          (command) =>
            command.id.startsWith(slashQuery) ||
            command.label.toLowerCase().replaceAll(" ", "-").startsWith(slashQuery),
        );
  const slashOpen =
    !slashDismissed && !plusOpen && !disabled && !isStreaming && slashMatches.length > 0;
  const [composerFocusOrigin, setComposerFocusOrigin] = useState<"keyboard" | "pointer">(
    "keyboard",
  );
  const [utilityMenu, setUtilityMenu] = useState<"files" | "plugins" | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryGrid, setLibraryGrid] = useState(false);
  const [librarySort, setLibrarySort] = useState<"recent" | "name">("recent");
  const [templateFormat, setTemplateFormat] = useState<ChatOutputFormat | null>(null);
  const libraryReturnFocus = useRef<HTMLElement | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  const projectAnchorRef = useRef<HTMLElement | null>(null);
  const [startProjectChat, setStartProjectChat] = useState(false);
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
    setPreviewAttachment(null);
    setPreviewOffset(0);
    setPastePreviewOpen(false);
    setRemovedPaste(null);
    setProjectPickerOpen(false);
    setSignInRequest(null);
    setPlusOpen(false);
    setUtilityMenu(null);
    setLibraryOpen(false);
    setTemplateFormat(null);
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
    realtime?: boolean,
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
    const reply = await latest.onVoiceSubmit(text.trim(), signal, realtime);
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
      if (!el.value) {
        setLongDraft(false);
        el.dataset.multiline = "false";
        el.style.height = `${minimum}px`;
        el.style.overflowY = "hidden";
        return;
      }
      const metrics = window.getComputedStyle(el);
      const singleLine = Math.max(
        parseFloat(metrics.minHeight) || 0,
        parseFloat(metrics.lineHeight) +
          parseFloat(metrics.paddingTop) +
          parseFloat(metrics.paddingBottom),
      );
      const composer = el.closest<HTMLElement>(".spec400-composer");
      if (composer && surface === "conversation" && !isMobileLayout && !isCoarsePointer) {
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
        const multiline = String(el.scrollHeight > singleLine + 1);
        if (el.dataset.multiline !== multiline) el.dataset.multiline = multiline;
        el.style.width = previousWidth;
      } else {
        el.style.height = "0px";
        const multiline = String(el.scrollHeight > singleLine + 1);
        if (el.dataset.multiline !== multiline) el.dataset.multiline = multiline;
      }
      const contentHeight = el.scrollHeight;
      setLongDraft(contentHeight >= limit);
      const height = Math.min(Math.max(contentHeight, minimum), limit);
      el.style.height = `${height}px`;
      el.style.overflowY = contentHeight > limit ? "auto" : "hidden";
    };
    resize();
    let width = el.getBoundingClientRect().width;
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      const nextWidth = el.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        // Height writes during ResizeObserver delivery can trigger a loop error
        // even when the next notification would be ignored by the width guard.
        if (resizeFrame === null) {
          resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = null;
            resize();
            width = el.getBoundingClientRect().width;
          });
        }
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [value, isLoaded, user?.id, isMobileLayout, isCoarsePointer, surface]);

  // Track on-screen keyboard on mobile so the composer floats above it.
  useEffect(() => {
    if (viewportManaged || !isMobileLayout || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKbOffset(
        composerKeyboardInset({
          layoutHeight: window.innerHeight,
          viewportHeight: vv.height,
          viewportTop: vv.offsetTop,
          scale: vv.scale,
          focused: document.activeElement === ref.current,
        }),
      );
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      setKbOffset(0);
    };
  }, [isMobileLayout, viewportManaged]);

  useEffect(() => {
    if (!isStreaming) submittingRef.current = false;
  }, [isStreaming, value, attachments.length]);

  useEffect(() => {
    if (disabled || isStreaming || !showAddMenu) setPlusOpen(false);
  }, [disabled, isStreaming, showAddMenu]);
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

  const requireAnalysisInput = () => {
    const tool = selectedToolRef.current;
    if (tool !== "data_analysis" && tool !== "file_analysis") return true;
    if (!requireFileAccount()) return false;
    if (
      tool === "file_analysis" &&
      !composerStateRef.current.attachments.some(
        (attachment) =>
          attachment.kind === "text_file" &&
          attachment.status !== "uploading" &&
          attachment.status !== "failed" &&
          Boolean(attachment.textContent?.trim()),
      )
    ) {
      const message = "Attach a text file or a document with extracted text to analyze files.";
      setUploadAnnouncement(message);
      toast.error(message);
      return false;
    }
    return true;
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
    if (!requireAnalysisInput()) return;
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

  const updateComposerText = (visible: string, caret: number) => {
    if (activeAtomicLink) {
      const kept = visible.includes(COMPOSER_LINK_MARKER);
      onChange(kept ? fromComposerLinkDisplay(visible, activeAtomicLink) : visible);
      if (!kept) setAtomicLinkRaw(null);
      return;
    }
    onChange(visible);
    // Typing an URL must not collapse it mid-word. Complete typed links when
    // whitespace is entered; pasted links collapse immediately.
    if (!composingRef.current && caret > 0 && /\s/u.test(visible[caret - 1])) {
      const token = firstLinkPreviewToken(visible, { requireBareDelimiter: true });
      if (token && token.end <= caret - 1) {
        setAtomicLinkRaw(token.raw);
        const position = caret - token.raw.length + 1;
        window.requestAnimationFrame(() => ref.current?.setSelectionRange(position, position));
      }
    }
  };

  const selectSlashCommand = (command: SlashCommand, trigger: HTMLElement | null) => {
    if (command === "model") {
      setSlashModels(true);
      requestAnimationFrame(() => slashListRef.current?.querySelector("button")?.focus());
      return;
    }
    if (command === "project" && !requireFileAccount(trigger)) {
      onChange("");
      setSlashDismissed(true);
      return;
    }
    onChange("");
    setSlashDismissed(true);
    if (command === "dictate" && dictationTriggerRef.current)
      openVoice("dictate", dictationTriggerRef.current);
    if (command === "feedback") setFeedbackOpen(true);
    if (command === "study") {
      const study = COMPOSER_TOOLS.find((tool) => tool.id === "study");
      if (study && onToolSelect) chooseTool(study);
    }
    if (command === "project") {
      projectTriggerRef.current = ref.current;
      projectAnchorRef.current = composerAnchorRef.current;
      setStartProjectChat(true);
      projectReturnUrlRef.current = window.location.href;
      setProjectPickerOpen(true);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Selected plugins follow the draft as atomic context tokens. The first
    // Backspace/Delete at the end removes a whole token instead of one letter.
    if (
      pluginContexts.length > 0 &&
      onPluginContextsChange &&
      !disabled &&
      (e.key === "Backspace" || e.key === "Delete") &&
      !(e.nativeEvent as KeyboardEvent).isComposing &&
      e.currentTarget.selectionStart === e.currentTarget.selectionEnd &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      e.preventDefault();
      onPluginContextsChange(pluginContexts.slice(0, -1));
      return;
    }
    // A link typed manually has the same one-keystroke removal behavior even
    // before its title chip has collapsed the editor text.
    if (
      !activeAtomicLink &&
      !disabled &&
      (e.key === "Backspace" || e.key === "Delete") &&
      !(e.nativeEvent as KeyboardEvent).isComposing
    ) {
      const token = firstLinkPreviewToken(value, { requireBareDelimiter: true });
      if (token) {
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        const hitsToken =
          start < end
            ? start < token.end && end > token.start
            : e.key === "Backspace"
              ? start > token.start && start <= token.end
              : start >= token.start && start < token.end;
        if (hitsToken) {
          e.preventDefault();
          const from = start < end ? Math.min(start, token.start) : token.start;
          const through = start < end ? Math.max(end, token.end) : token.end;
          onChange(value.slice(0, from) + value.slice(through));
          window.requestAnimationFrame(() => ref.current?.setSelectionRange(from, from));
          return;
        }
      }
    }
    if (activeAtomicLink && (e.key === "Backspace" || e.key === "Delete")) {
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const markerAt = visibleComposerValue.indexOf(COMPOSER_LINK_MARKER);
      const hitsToken =
        markerAt >= 0 &&
        (start < end
          ? start <= markerAt && markerAt < end
          : (e.key === "Backspace" && start === markerAt + 1) ||
            (e.key === "Delete" && start === markerAt));
      if (hitsToken) {
        e.preventDefault();
        const next =
          start < end
            ? visibleComposerValue.slice(0, start) + visibleComposerValue.slice(end)
            : visibleComposerValue.slice(0, markerAt) + visibleComposerValue.slice(markerAt + 1);
        setAtomicLinkRaw(null);
        onChange(next);
        const caret = start < end ? start : markerAt;
        window.requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret));
        return;
      }
    }
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (slashOpen && !slashModels && !native.isComposing && !composingRef.current) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((index) => (index + step + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const command = slashMatches[slashIndex] ?? slashMatches[0];
        selectSlashCommand(command.id, ref.current);
        return;
      }
    }
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
            na…15314 tokens truncated…     : null}
        {isDesktop ? <OpenDesktopAppButton /> : null}
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
        inlineDictation
        autoStartVoice
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
      {nextPromptPanel}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            ref.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Feedback</DialogTitle>
            <DialogDescription>Tell us what happened in this chat.</DialogDescription>
          </DialogHeader>
          <HelpSupportForm compact />
        </DialogContent>
      </Dialog>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="spec400-expanded-input"
          onPointerDownCapture={(event) => {
            // Blurring the textarea hides the keyboard and moves these controls
            // between pointer-down and click. Keep their position until dismissal.
            if (
              event.button === 0 &&
              document.documentElement.hasAttribute("data-kova-keyboard") &&
              event.target instanceof Element &&
              event.target.closest(".spec400-dialog-footer button, [data-kova-dialog-close]")
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            expandTriggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Expand input</DialogTitle>
            <DialogDescription className="spec400-expanded-description">
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
            placeholder="Ask KovaGPT anything..."
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
        attachmentPreview
        open={previewAttachment !== null || pastePreviewOpen}
        onOpenChange={(open) => {
          if (!open) closeAttachmentPreview();
        }}
      >
        <DialogContent
          attachmentPreview
          className={`spec400-attachment-preview ${previewImage ? "kova-preview-mobile-image" : "kova-preview-mobile-file"}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previewReturnToInputRef.current || !previewTriggerRef.current?.isConnected)
              ref.current?.focus({ preventScroll: true });
            else previewTriggerRef.current?.focus({ preventScroll: true });
            previewReturnToInputRef.current = false;
          }}
        >
          <DialogHeader className="kova-preview-mobile-description">
            <DialogTitle>{previewName}</DialogTitle>
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
          <AttachmentPreviewMobileHeader
            title={previewImage ? undefined : previewName}
            onDownload={
              previewImage ? () => void runPreviewImageAction(downloadChatImage) : undefined
            }
            onShare={previewImage ? () => void runPreviewImageAction(shareChatImage) : undefined}
            actions={
              previewImage ? (
                <button
                  type="button"
                  className="kova-preview-action"
                  onClick={() => void runPreviewImageAction(copyChatImage)}
                >
                  Copy image
                </button>
              ) : previewText !== undefined ? (
                <button
                  type="button"
                  className="kova-preview-action"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(previewText);
                      toast.success("Text copied");
                    } catch {
                      toast.error("Could not copy the text.");
                    }
                  }}
                >
                  Copy text
                </button>
              ) : (
                <p className="p-2 text-sm">
                  {previewAttachment ? attachmentState(previewAttachment) : "Attachment"}
                </p>
              )
            }
          />
          <div className={previewImage ? "kova-preview-image-stage" : "kova-preview-file-stage"}>
            {previewAttachment &&
              !previewImage &&
              !previewAttachment.localPaste &&
              !pastePreviewOpen && (
                <AttachmentPreviewFileInfo
                  name={previewAttachment.name}
                  size={previewAttachment.size}
                />
              )}
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
                Page count, page selection and page-read results are unavailable for this
                attachment. Saved text-only records do not retain PDF page metadata. Attach the
                original PDF again to inspect its pages.
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
                  <div
                    className="spec400-preview-pages"
                    role="group"
                    aria-label="Text preview pages"
                  >
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
          </div>
          {previewAttachment?.status === "complete" &&
            !pastePreviewOpen &&
            !previewAttachment.localPaste &&
            !previewImage &&
            onAskAttachment && (
              <AttachmentPreviewAsk
                onAsk={(prompt) => {
                  if (!onAskAttachment(prompt, previewAttachment)) return false;
                  closeAttachmentPreview();
                  return true;
                }}
              />
            )}
        </DialogContent>
      </Dialog>
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent
          className="sm:max-w-2xl rounded-[24px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = libraryReturnFocus.current;
            libraryReturnFocus.current = null;
            if (target?.isConnected) target.focus();
            else ref.current?.focus();
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
          <p className="spec400-attachment-limits">
            <ComposerUploadAllowance ownerId={isLoaded ? (user?.id ?? null) : null} />
          </p>
          {user ? (
            renderRecentLibraryFiles(true)
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
      {(isLoaded && user) || projectPickerOpen ? (
        <Suspense fallback={null}>
          <ComposerProjectPicker
            open={projectPickerOpen}
            onOpenChange={setProjectPickerOpen}
            onSelectProject={onProjectContext}
            navigationBlocked={Boolean(
              isStreaming ||
              disabled ||
              ((!onProjectContext || startProjectChat) && (value.length || attachments.length)),
            )}
            navigationBlockedReason="Send or clear this message and its attachments before opening a project. Your current chat will not be moved."
            anchorRef={projectAnchorRef}
            startChat={startProjectChat}
            side={startProjectChat && (surface === "conversation" || longDraft) ? "top" : "bottom"}
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
