import { ChatOutputTemplates } from "./ChatOutputTemplates";
import { t } from "@/lib/localization";
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
  DEFAULT_CONSUMER_MODEL,
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
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Search,
  LibraryBig,
  Pencil,
  Folder,
  AlertCircle,
  Loader2,
  Target,
  type LucideIcon,
} from "lucide-react";
import { ExpandViewIcon } from "@/components/ui/ExpandViewIcon";

import {
  attachmentPreviewWindow,
  isFreePastedText,
  pasteAttachmentIntoDraft,
  PASTED_TEXT_MAX_CHARACTERS,
  PASTED_TEXT_MAX_PER_MESSAGE,
  prepareLocalPaste,
  shouldCardPaste,
  summarizeLocalPaste,
  utf8TextBytes,
} from "@/lib/composer-local-attachments.mjs";
import { PastedTextCard } from "@/components/PastedTextCard";
import { ChatGoalRow } from "@/components/ChatGoalRow";
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
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  Fragment,
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
  canonicalComposerOffset,
  composerLinkDisplay,
  composerTextChange,
  firstLinkPreviewToken,
  linkPreviewTokens,
  type ComposerLinkToken,
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

/** [principal, chatId] for the goal row, only when the composer is not editing a message. */
function chatGoalContext(attachmentContext: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(attachmentContext ?? "null");
    return Array.isArray(parsed) && parsed[2] == null
      ? {
          principal: typeof parsed[0] === "string" ? parsed[0] : null,
          chatId: typeof parsed[1] === "string" ? parsed[1] : null,
        }
      : null;
  } catch {
    return null;
  }
}

// Pasted cards are message text: they never take one of the two file slots.
function fileSlotsUsed(items: PendingAttachment[]) {
  return items.filter((item) => !item.pasted).length;
}

export type PendingAttachment = {
  clientId?: string;
  source?: "file_upload" | "library";
  kind: "image" | "text_file" | "library_file";
  dataUrl: string;
  textContent?: string;
  /** Local clipboard input; it is not uploaded or saved before explicit Send. */
  localPaste?: boolean;
  /** Pasted message text shown as a card: no account, slot or upload allowance needed. */
  pasted?: boolean;
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
  /\.(txt|md|markdown|csv|tsv|json|jsonl|excalidraw|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|sh|bash|zsh|fish|env|ini|conf|log|srt|vtt)$/i;
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

let handledHomeStartupFocus = false;

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
  showAddMenu = true,
  saveAttachmentsToLibrary = false,
  attachments,
  onAttachmentsChange,
  mode,
  onModeChange,
  hostedModel,
  onHostedModelChange,
  recommendedModelSelection = false,
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
  focusOnHomeStartup,
  attachmentContext,
  latestAssistantText = "",
  latestAssistantReply,
  voiceMode,
  voiceSessionContext,
  onVoiceModeChange,
  onVoiceSubmit,
  onVoicePlaybackProgress,
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
  /** Hides and disables attachments, tools, and prompt shortcuts. */
  showAddMenu?: boolean;
  /** Only persistent, authenticated chat may automatically retain uploads. */
  saveAttachmentsToLibrary?: boolean;
  attachments: PendingAttachment[];
  onAttachmentsChange: (a: PendingAttachment[]) => void;
  mode?: ModeId;
  onModeChange?: (m: ModeId) => void;
  hostedModel?: ConsumerModelId;
  onHostedModelChange?: (model: ConsumerModelId, recommended?: boolean) => void;
  recommendedModelSelection?: boolean;
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
  /** Undefined until the home route has restored the signed-in workspace. */
  focusOnHomeStartup?: boolean;
  /** Invalidate pending reads when changing chat or entering/leaving prompt edit. */
  attachmentContext?: string;
  /** Completed assistant reply available for explicitly requested speech playback. */
  latestAssistantText?: string;
  /** Exact saved, model-proven reply; text alone never authorizes playback. */
  latestAssistantReply?: { chatId: string; messageId: string; content: string };
  /** Controlled by the chat route so opening a new voice chat survives layout changes. */
  voiceMode?: "dictate" | "voice" | null;
  voiceSessionContext?: string;
  onVoiceModeChange?: (mode: "dictate" | "voice" | null) => void;
  /** Uses the existing chat/history path and returns only a confirmed saved reply. */
  onVoiceSubmit?: ComposerVoiceSubmit;
  onVoicePlaybackProgress?: (fraction: number | null) => void;
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
  const [collapsedLinks, setCollapsedLinks] = useState<ComposerLinkToken[]>([]);
  // Only the editor displays the compact tokens. The draft keeps exact URLs.
  const draftLinks = linkPreviewTokens(value);
  const activeLinks = draftLinks.filter((link) =>
    collapsedLinks.some(({ start, raw }) => start === link.start && raw === link.raw),
  );
  const editor = composerLinkDisplay(value, activeLinks);
  const previewLinks = draftLinks.filter(
    (link) =>
      link.end < value.length || /^https:\/\//iu.test(link.raw) || activeLinks.includes(link),
  );
  const mediaOrderRef = useRef<{ context: typeof attachmentContextRef.current; keys: string[] }>(
    null,
  );
  const composerStateRef = useRef({ value, attachments });
  composerStateRef.current = { value, attachments };
  const updateAttachments = (next: PendingAttachment[]) => {
    composerStateRef.current.attachments = next;
    onAttachmentsChange(next);
  };
  const uploadBatchRef = useRef(false);
  useEffect(() => {
    setPasteOffer(null);
    setCollapsedLinks([]);
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
  useEffect(() => {
    if (focusOnHomeStartup === undefined || handledHomeStartupFocus) return;
    handledHomeStartupFocus = true;
    const input = ref.current;
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (
      !focusOnHomeStartup ||
      !input ||
      input.disabled ||
      !navigation ||
      navigation.type === "back_forward" ||
      new URL(navigation.name).pathname !== "/" ||
      window.location.pathname !== "/" ||
      !window.matchMedia(
        "(width < 768px) and (pointer: coarse), (width < 1024px) and (height <= 500px) and (pointer: coarse)",
      ).matches ||
      document.visibilityState !== "visible" ||
      document.activeElement !== document.body ||
      document.querySelector('dialog[open], [aria-modal="true"]')
    )
      return;
    input.focus({ preventScroll: true });
  }, [focusOnHomeStartup]);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const plusTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PendingAttachment | null>(null);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [pastePreviewOpen, setPastePreviewOpen] = useState(false);
  /** Draft text while a pasted card is being edited in the preview dialog. */
  const [pasteEditDraft, setPasteEditDraft] = useState<string | null>(null);
  const [removedPaste, setRemovedPaste] = useState<PendingAttachment | null>(null);
  const previewReturnToInputRef = useRef(false);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const undoPasteButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedToolRef = useRef(selectedTool);
  selectedToolRef.current = selectedTool;

  const [plusOpen, setPlusOpen] = useState(false);
  const [mobileIntelligenceOpen, setMobileIntelligenceOpen] = useState(false);
  const sendHold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const sendHoldConsumed = useRef(false);
  const cancelSendHold = useCallback(() => {
    if (sendHold.current) window.clearTimeout(sendHold.current.timer);
    sendHold.current = null;
  }, []);
  useEffect(() => cancelSendHold, [cancelSendHold]);

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
  const [goalEditing, setGoalEditing] = useState(false);
  // The goal belongs to this chat: [principal, chatId] from the composer's chat context.
  const goalContext = chatGoalContext(attachmentContext);
  const [resourceSection, setResourceSection] = useState<"files" | "plugins" | null>(null);
  const phoneResourceSection = isMobileLayout ? resourceSection : null;
  const addMenuRef = useRef<HTMLDivElement>(null);
  const resourceBackRef = useRef<HTMLButtonElement>(null);
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
  const voiceContextKey = voiceSessionContext ?? attachmentContext ?? "composer";
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
    if (voiceModeRef.current === "voice" && next !== "voice") onVoicePlaybackProgress?.(null);
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
      if (composer && surface === "conversation" && !isMobileLayout) {
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
      if (resizeFrame !== null) return;
      // WebKit can deliver nested layout notifications when a callback forces
      // geometry. Defer both the width measurement and height writes.
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        const nextWidth = el.getBoundingClientRect().width;
        if (nextWidth === width) return;
        resize();
        width = el.getBoundingClientRect().width;
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [value, isLoaded, user?.id, isMobileLayout, surface]);

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
    if (disabled || submittingRef.current || isStreaming || pasteOffer) return;
    if (!online) return;
    if (!value.trim() && !validAttachmentInstruction) return;
    if (
      (fileSlotsUsed(attachments) > 0 || selectedToolRef.current === "image") &&
      !requireFileAccount()
    )
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

  const editComposerDraft = (
    start: number,
    end: number,
    text: string,
    { completeLinks = false, visible }: { completeLinks?: boolean; visible?: string } = {},
  ) => {
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    const shift = caret - end;
    const remaining = activeLinks.filter((link) => link.end <= start || link.start >= end);
    const collapsed = linkPreviewTokens(next).filter(
      (link) =>
        (completeLinks && link.end <= caret) ||
        remaining.some(
          (previous) =>
            previous.raw === link.raw &&
            (previous.end <= start ? previous.start : previous.start + shift) === link.start,
        ),
    );
    setCollapsedLinks(collapsed);
    onChange(next);
    if (visible !== composerLinkDisplay(next, collapsed).text) {
      const position = composerLinkDisplay(
        next.slice(0, caret),
        collapsed.filter((link) => link.end <= caret),
      ).text.length;
      window.requestAnimationFrame(() => ref.current?.setSelectionRange(position, position));
    }
  };

  const updateComposerText = (visible: string, caret: number) => {
    if (visible === editor.text) return;
    const change = composerTextChange(editor.text, visible, caret);
    const start = canonicalComposerOffset(editor, change.start);
    const end = canonicalComposerOffset(editor, change.end);
    // Typing a word immediately after a collapsed page starts new text.
    const separator =
      /^[\p{L}\p{N}]/u.test(change.text) && activeLinks.some((link) => link.end === start)
        ? " "
        : "";
    editComposerDraft(start, end, separator + change.text, {
      completeLinks: !composingRef.current && /\s$/u.test(change.text),
      visible,
    });
  };

  const openProjectPicker = (
    startChat: boolean,
    trigger: HTMLElement | null,
    anchor: HTMLElement | null = composerAnchorRef.current,
  ) => {
    projectTriggerRef.current = trigger;
    projectAnchorRef.current = anchor;
    setStartProjectChat(startChat);
    projectReturnUrlRef.current = window.location.href;
    setProjectPickerOpen(true);
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
    if (command === "project") openProjectPicker(true, ref.current);
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
    // Erase the whole URL wherever a deletion touches a previewed link.
    if (
      !disabled &&
      (e.key === "Backspace" || e.key === "Delete") &&
      !(e.nativeEvent as KeyboardEvent).isComposing
    ) {
      const start = canonicalComposerOffset(editor, e.currentTarget.selectionStart);
      const end = canonicalComposerOffset(editor, e.currentTarget.selectionEnd);
      const touched = previewLinks.filter((link) =>
        start < end
          ? start < link.end && end > link.start
          : e.key === "Backspace"
            ? start > link.start && start <= link.end
            : start >= link.start && start < link.end,
      );
      if (touched.length) {
        e.preventDefault();
        editComposerDraft(
          Math.min(start, touched[0].start),
          Math.max(end, touched.at(-1)!.end),
          "",
        );
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
    const availableSlots = Math.max(0, 2 - fileSlotsUsed(attachments));
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
        const isExcalidraw = /\.excalidraw$/iu.test(f.name);
        const isImage = !isExcalidraw && f.type.startsWith("image/");
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
            } else if (isExcalidraw) {
              const { summarizeExcalidrawScene } = await import("@/lib/excalidraw-scene.mjs");
              if (!currentRead()) return false;
              textContent = summarizeExcalidrawScene(await f.text());
              extractionNote = "Attached the diagram's text and layout summary.";
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
              ...(isDocument || isExcalidraw
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

  const externalImageFiles = useRef(addFiles);
  externalImageFiles.current = addFiles;
  // Text handed over with images (for example notes from the image canvas) appends to the draft.
  const externalAppendText = useRef((text: string) => {
    void text;
  });
  externalAppendText.current = (text: string) => {
    const draft = composerStateRef.current.value;
    onChange(draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text);
  };
  useEffect(() => {
    let mounted = true;
    const prepare = (event: Event) => {
      if (event.target !== ref.current?.closest("[data-chat-image-context]")) return;
      const detail = (
        event as CustomEvent<import("@/lib/chat-image-actions").ChatImageAttachmentRequest>
      ).detail;
      if (!detail || typeof detail.accept !== "function") return;
      const context = attachmentContextRef.current;
      const scope = attachmentScopeRef.current;
      detail.acceptText?.((text) => {
        if (mounted && context === attachmentContextRef.current && typeof text === "string")
          externalAppendText.current(text.slice(0, 4_000));
      });
      detail.accept(async (file, isCurrent) => {
        const current = () =>
          mounted &&
          isCurrent() &&
          context === attachmentContextRef.current &&
          scope === attachmentScopeRef.current;
        if (!current()) throw new DOMException("The image action was cancelled.", "AbortError");
        const attached = await externalImageFiles.current([file]);
        if (!current() || !attached) return;
        toast.success("Image added to your message");
        const focused = document.activeElement;
        if (focused === document.body || focused?.closest('[data-chat-image], [role="menuitem"]'))
          ref.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("kova:prepare-chat-image-attachment", prepare);
    return () => {
      mounted = false;
      window.removeEventListener("kova:prepare-chat-image-attachment", prepare);
    };
  }, []);

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
    if (fileSlotsUsed(current.attachments) >= 2) {
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
        pasteSummary: paste.summary,
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
      // A pasted page/video URL is one removable composer token, not dozens
      // of individual characters. The canonical prompt still stores the URL.
      const plain = event.clipboardData.getData("text/plain");
      const target = event.target as HTMLElement;
      if (
        !disabled &&
        target === ref.current &&
        !shouldCardPaste(plain) &&
        firstLinkPreviewToken(plain)
      ) {
        event.preventDefault();
        const field = ref.current;
        const start = canonicalComposerOffset(editor, field.selectionStart);
        const end = canonicalComposerOffset(editor, field.selectionEnd);
        const leadingSpace = /\S/u.test(value[start - 1] ?? "") && /^\S/u.test(plain) ? " " : "";
        const trailingSpace = /\S/u.test(value[end] ?? "") && /\S$/u.test(plain) ? " " : "";
        editComposerDraft(start, end, leadingSpace + plain + trailingSpace, {
          completeLinks: true,
        });
        return;
      }
      // Native short-text paste remains untouched for other content.
      if (disabled || !showAddMenu || !shouldCardPaste(plain)) return;
      // Long text up to the typed-message limit becomes a "Pasted" card. It is message
      // text, so guests can use it and it takes no file slot or upload allowance.
      if (isFreePastedText(plain)) {
        event.preventDefault();
        const current = composerStateRef.current;
        if (
          current.attachments.filter((item) => item.pasted).length >= PASTED_TEXT_MAX_PER_MESSAGE
        ) {
          const message = `You can include up to ${PASTED_TEXT_MAX_PER_MESSAGE} pasted texts per message.`;
          setUploadAnnouncement(message);
          toast.error(message);
          return;
        }
        const selectionPasteTarget = event.target as HTMLTextAreaElement | undefined;
        const selectionTarget =
          selectionPasteTarget?.tagName === "TEXTAREA" ? selectionPasteTarget : ref.current;
        const start = selectionTarget?.selectionStart ?? current.value.length;
        const end = selectionTarget?.selectionEnd ?? current.value.length;
        // Pasted cards are never auto-saved to Library; they are message text.
        const pasteId = crypto.randomUUID();
        updateAttachments([
          ...current.attachments,
          {
            clientId: pasteId,
            source: "file_upload",
            kind: "text_file",
            dataUrl: "",
            textContent: plain,
            localPaste: true,
            pasted: true,
            pasteSummary: summarizeLocalPaste(plain),
            pasteOrigin: {
              original: current.value,
              start:
                selectionTarget === ref.current ? canonicalComposerOffset(editor, start) : start,
              end: selectionTarget === ref.current ? canonicalComposerOffset(editor, end) : end,
            },
            name: "pasted-text.txt",
            fileType: "text/plain",
            size: utf8TextBytes(plain),
            status: "complete",
          },
        ]);
        setRemovedPaste(null);
        setUploadAnnouncement(
          "Long text pasted as a card. Select it to read or edit it, or put it back into the message.",
        );
        return;
      }
      event.preventDefault();
      if (pasteOffer) {
        setUploadAnnouncement(
          "Finish with the existing pasted text before adding another large paste. The new text remains on your clipboard.",
        );
        return;
      }
      const selectionPasteTarget = event.target as HTMLTextAreaElement | undefined;
      const selectionTarget =
        selectionPasteTarget?.tagName === "TEXTAREA" ? selectionPasteTarget : ref.current;
      try {
        const prepared = prepareLocalPaste(plain);
        const start = selectionTarget?.selectionStart ?? value.length;
        const end = selectionTarget?.selectionEnd ?? value.length;
        const paste = {
          ...prepared,
          id: crypto.randomUUID(),
          original: composerStateRef.current.value,
          start: selectionTarget === ref.current ? canonicalComposerOffset(editor, start) : start,
          end: selectionTarget === ref.current ? canonicalComposerOffset(editor, end) : end,
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
    setPasteEditDraft(null);
    setRemovedPaste(null);
    previewReturnToInputRef.current = true;
    setUploadAnnouncement("Exact pasted text restored to the message.");
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const undoPasteRemoval = () => {
    if (
      !removedPaste ||
      disabled ||
      (removedPaste.pasted
        ? composerStateRef.current.attachments.filter((item) => item.pasted).length >=
          PASTED_TEXT_MAX_PER_MESSAGE
        : fileSlotsUsed(composerStateRef.current.attachments) >= 2)
    )
      return;
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
    if (fileSlotsUsed(attachments) >= 2) {
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
    setUtilityMenu(null);
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

  const sortedPickerFiles =
    librarySort === "name"
      ? [...visibleRecentLibraryFiles].sort((first, second) =>
          (first.fileName || first.title).localeCompare(second.fileName || second.title),
        )
      : visibleRecentLibraryFiles;
  const renderRecentLibraryFiles = (picker = false) => (
    <div className="kova-composer-library" aria-label="Saved Library files">
      {recentLibraryFiles.length > 0 || !recentLibraryLoading ? (
        <div className="flex items-center gap-2">
          <label className="kova-composer-menu-search flex-1">
            <Search aria-hidden="true" />
            <span className="sr-only">Search Library files</span>
            <input
              value={recentQuery}
              onChange={(event) => setRecentQuery(event.target.value)}
              placeholder={picker ? "Search Library" : "Search Library files..."}
              className="w-full bg-transparent text-sm"
            />
          </label>
          {picker && (
            <>
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-accent"
                aria-label={libraryGrid ? "List view" : "Grid view"}
                onClick={() => setLibraryGrid(!libraryGrid)}
              >
                {libraryGrid ? <ListIcon aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Library options"
                    className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-accent"
                  >
                    <SettingsIcon aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" aria-label="Library options" className="z-[110] w-52">
                  <fieldset className="grid gap-2 text-sm">
                    <legend className="mb-2 text-muted-foreground">Sort files</legend>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={librarySort === "recent"}
                        onChange={() => setLibrarySort("recent")}
                      />
                      Most recent
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={librarySort === "name"}
                        onChange={() => setLibrarySort("name")}
                      />
                      Name
                    </label>
                  </fieldset>
                  {onRecentLibraryRetry && (
                    <button
                      type="button"
                      className="kova-library-refresh mt-3"
                      onClick={onRecentLibraryRetry}
                      disabled={recentLibraryLoading}
                    >
                      Refresh Library
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
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
          {recentQuery.trim() ? "No matching files." : "No saved files yet."}
        </div>
      ) : (
        <div
          className={
            picker
              ? `max-h-[55dvh] overflow-y-auto p-1 ${libraryGrid ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "divide-y divide-border"}`
              : "max-h-64 overflow-y-auto p-1"
          }
        >
          {(picker ? sortedPickerFiles : visibleRecentLibraryFiles.slice(0, 12)).map((item) => {
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
                {item.fileType?.startsWith("image/") ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-pink-400" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
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

  const pluginConnections = useComposerPluginConnections(
    isLoaded && showAddMenu ? (user?.id ?? null) : null,
    isLoaded,
  );

  const renderComposerActions = (
    mobile: boolean,
    section: "all" | "files" | "plugins" = "all",
    trigger: HTMLElement | null = plusTriggerRef.current,
  ) => {
    const closeActions = () => {
      setPlusOpen(false);
      setUtilityMenu(null);
    };
    const pickFile = (input: React.RefObject<HTMLInputElement | null>) => {
      closeActions();
      if (!requireFileAccount(trigger)) return;
      input.current?.click();
    };
    const openLibrary = () => {
      closeActions();
      if (!requireFileAccount(trigger)) return;
      libraryReturnFocus.current = null;
      setLibraryOpen(true);
      onRecentLibraryRetry?.();
    };
    if (section === "plugins") {
      return (
        <ComposerPluginList
          connections={pluginConnections}
          userId={isLoaded ? (user?.id ?? null) : null}
          authLoaded={isLoaded}
          conversations={user ? savedConversations : []}
          selectedPluginIds={pluginContexts.map((plugin) => plugin.id)}
          navigationBlocked={Boolean(value.length || attachments.length || isStreaming || disabled)}
          onSelect={
            onPluginContextsChange
              ? (plugin) => {
                  const selected = pluginContexts.some((item) => item.id === plugin.id);
                  onPluginContextsChange(
                    selected
                      ? pluginContexts.filter((item) => item.id !== plugin.id)
                      : [...pluginContexts, plugin],
                  );
                  closeActions();
                  window.requestAnimationFrame(() => ref.current?.focus());
                }
              : undefined
          }
          onRequireSignIn={() => {
            closeActions();
            setSignInRequest({ description: "Sign in to manage your plugins.", trigger });
          }}
          onNavigate={closeActions}
        />
      );
    }
    if (section === "files")
      return (
        <>
          {renderRecentLibraryFiles()}
          <Link
            to="/library"
            target={value || attachments.length ? "_blank" : undefined}
            className="kova-composer-action"
            onClick={closeActions}
          >
            <LibraryBig aria-hidden="true" /> Browse all
          </Link>
        </>
      );
    return (
      <div className="kova-composer-quick-menu">
        <button
          type="button"
          aria-label="Add photos & files"
          className="kova-composer-action"
          onClick={() => pickFile(fileRef)}
        >
          <Paperclip aria-hidden="true" />
          <span>Add photos &amp; files</span>
          <small>
            {mobile
              ? isTablet
                ? "Upload from your tablet"
                : "Upload from your phone"
              : "Upload from your computer"}
          </small>
        </button>
        <button
          type="button"
          aria-label="Add from Library"
          className="kova-composer-action"
          onClick={openLibrary}
        >
          <span className="kova-composer-library-glyph" aria-hidden="true">
            <FileText />
          </span>
          <span>Add from Library</span>
          <small>Add photos and files saved in your Library</small>
        </button>
        <button
          type="button"
          aria-label="Create an image"
          className="kova-composer-action"
          disabled={!isLoaded || (Boolean(user) && !onToolSelect) || disabled || isStreaming}
          aria-pressed={selectedTool === "image"}
          onClick={() => {
            closeActions();
            if (!requireFileAccount(trigger)) return;
            chooseTool(COMPOSER_TOOLS.find((tool) => tool.id === "image")!);
          }}
        >
          <span className="kova-composer-image-glyph" aria-hidden="true">
            <ImageIcon />
          </span>
          <span>Create an image</span>
          <small>Visualize anything</small>
        </button>
        <button
          type="button"
          aria-label="Web search"
          className="kova-composer-action"
          disabled={!onToolSelect || disabled || isStreaming}
          aria-pressed={selectedTool === "web_search"}
          onClick={() => chooseTool(COMPOSER_TOOLS.find((tool) => tool.id === "web_search")!)}
        >
          <Globe aria-hidden="true" className="kova-composer-web-glyph" />
          <span>Web search</span>
          <small>Search real-time data and analytics</small>
        </button>
        <button
          type="button"
          aria-label="Work in a project"
          className="kova-composer-action"
          disabled={!isLoaded || disabled || isStreaming}
          onClick={() => {
            closeActions();
            if (!requireFileAccount(trigger)) return;
            openProjectPicker(true, trigger);
          }}
        >
          <Folder aria-hidden="true" />
          <span>Work in a project</span>
          <small>Start a new chat in an existing project</small>
        </button>
        <button
          type="button"
          className="kova-composer-action"
          disabled={!isLoaded || disabled || isStreaming}
          onClick={() => {
            closeActions();
            if (!requireFileAccount(trigger)) return;
            setDrawingOpen(true);
          }}
        >
          <Pencil aria-hidden="true" />
          <span>Drawing</span>
        </button>
        {mobile ? (
          <button
            type="button"
            className="kova-composer-action"
            onClick={() => pickFile(cameraRef)}
          >
            <Camera aria-hidden="true" />
            <span>Camera</span>
          </button>
        ) : null}
        {mobile ? (
          <button type="button" className="kova-composer-action" onClick={() => pickFile(photoRef)}>
            <ImageIcon aria-hidden="true" />
            <span>Photos</span>
          </button>
        ) : null}
        {mobile && surface === "empty" && showResources ? (
          <div className="kova-phone-resource-actions" role="group" aria-label="Chat resources">
            {showChooseProject ? (
              <button
                type="button"
                className="kova-composer-action"
                aria-label="Choose project"
                disabled={!isLoaded || disabled || isStreaming}
                onClick={() => {
                  closeActions();
                  if (requireFileAccount(trigger)) openProjectPicker(false, trigger);
                }}
              >
                <Folder aria-hidden="true" />
                <span>Choose project</span>
                <small>Use a project in this message</small>
              </button>
            ) : null}
            {(["files", "plugins"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className="kova-composer-action"
                data-composer-resource={item}
                onClick={() => {
                  setResourceSection(item);
                  window.requestAnimationFrame(() => resourceBackRef.current?.focus());
                }}
              >
                {item === "files" ? <LibraryBig aria-hidden="true" /> : <Plug aria-hidden="true" />}
                <span>{item === "files" ? "Files" : "Plugins"}</span>
                <ChevronRight aria-hidden="true" className="ml-auto" />
              </button>
            ))}
          </div>
        ) : null}
        {goalContext && (
          <div className="kova-composer-menu-section">
            <button
              type="button"
              aria-label="Set a goal for this chat"
              className="kova-composer-action"
              onClick={() => {
                closeActions();
                setGoalEditing(true);
              }}
            >
              <Target aria-hidden="true" />
              <span>{t("Set a goal")}</span>
              <small>{t("Keep this chat working toward one outcome")}</small>
            </button>
          </div>
        )}
        {user ? (
          <ComposerPluginList
            connections={pluginConnections}
            userId={user.id}
            authLoaded={isLoaded}
            conversations={savedConversations}
            navigationBlocked={Boolean(
              value.length || attachments.length || isStreaming || disabled,
            )}
            onNavigate={closeActions}
            inline
          />
        ) : null}
      </div>
    );
  };

  useImperativeHandle(activityComposerRef, () => ({
    addFiles(trigger) {
      if (!disabled && !isStreaming && requireFileAccount(trigger)) fileRef.current?.click();
    },
    openLibrary(trigger) {
      if (disabled || isStreaming || !requireFileAccount(trigger)) return;
      libraryReturnFocus.current = trigger;
      setLibraryOpen(true);
      onRecentLibraryRetry?.();
    },
    openTemplates(format) {
      if (!disabled && !isStreaming && !activeVoiceMode) setTemplateFormat(format);
    },
  }));

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
  const paidModelPicker =
    userTier !== "free" &&
    canChangeAgent &&
    hostedModel &&
    onHostedModelChange &&
    mode &&
    onModeChange;
  const canSubmit =
    !pasteOffer &&
    !disabled &&
    online &&
    Boolean(value.trim() || validAttachmentInstruction) &&
    !blockedAttachmentMessage;

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const closedGroups = Array.from(event.currentTarget.querySelectorAll("details:not([open])"));
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],summary"),
    ).filter(
      (control) =>
        control.getClientRects().length > 0 &&
        closedGroups.every(
          (group) => !group.contains(control) || group.firstElementChild === control,
        ),
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
  const previewImage = previewAttachment?.kind === "image" ? previewAttachment.dataUrl : null;
  const previewName = pastePreviewOpen
    ? pasteOffer?.summary
    : (previewAttachment?.pasteSummary ?? previewAttachment?.name);
  const attachmentPreviewRef = useRef(previewAttachment);
  attachmentPreviewRef.current = previewAttachment;
  const runPreviewImageAction = async (
    action: (src: string, allowed: () => boolean) => Promise<unknown>,
  ) => {
    if (!previewImage) return;
    const allowed = () => attachmentPreviewRef.current === previewAttachment;
    try {
      await action(previewImage, allowed);
    } catch (error) {
      if (allowed()) toast.error(error instanceof Error ? error.message : "Image action failed.");
    }
  };
  const closeAttachmentPreview = () => {
    attachmentPreviewRef.current = null;
    setPreviewAttachment(null);
    setPastePreviewOpen(false);
    setPasteEditDraft(null);
    setPreviewOffset(0);
  };
  const savePastedEdit = () => {
    const target = previewAttachment;
    const draft = pasteEditDraft;
    if (!target || draft === null || disabled) return;
    const current = composerStateRef.current.attachments;
    const index = current.indexOf(target);
    if (index < 0) return closeAttachmentPreview();
    if (!draft.trim()) {
      closeAttachmentPreview();
      removeAttachment(index);
      return;
    }
    if (target.pasted && draft.length > PASTED_TEXT_MAX_CHARACTERS) {
      const message = `Pasted text can be up to ${PASTED_TEXT_MAX_CHARACTERS.toLocaleString()} characters. Shorten it or attach it as a file.`;
      setUploadAnnouncement(message);
      toast.error(message);
      return;
    }
    const updated: PendingAttachment = {
      ...target,
      textContent: draft,
      pasteSummary: summarizeLocalPaste(draft),
      size: utf8TextBytes(draft),
    };
    updateAttachments(current.map((item, position) => (position === index ? updated : item)));
    setPreviewAttachment(updated);
    setPasteEditDraft(null);
    setUploadAnnouncement("Pasted text updated.");
  };
  const hasDraft = Boolean(value.trim() || attachments.length || pasteOffer);

  const mediaTiles = new Map<string, ReactNode>();
  attachments.forEach((attachment, index) => {
    if (attachment.kind === "text_file" && attachment.localPaste && attachment.textContent) {
      // Long pastes are square cards that sit with photos at the front of the composer.
      const pastedText = attachment.textContent;
      mediaTiles.set(
        `photo:paste:${attachment.clientId ?? index}`,
        <li className="spec400-pasted-item" data-kind="pasted" data-status={attachment.status}>
          <PastedTextCard
            text={pastedText}
            summary={attachment.pasteSummary}
            inspectLabel={`Inspect ${attachment.name}`}
            removeLabel={`Remove ${attachment.name}`}
            status={attachment.status}
            disabled={disabled}
            onOpen={(trigger) => {
              previewTriggerRef.current = trigger;
              previewReturnToInputRef.current = false;
              setPreviewOffset(0);
              setPasteEditDraft(null);
              setPreviewAttachment(attachment);
            }}
            onEdit={(trigger) => {
              previewTriggerRef.current = trigger;
              previewReturnToInputRef.current = false;
              setPreviewOffset(0);
              setPasteEditDraft(pastedText);
              setPreviewAttachment(attachment);
            }}
            onRemove={() => removeAttachment(index)}
          />
        </li>,
      );
      return;
    }
    const isPhoto = attachment.kind === "image";
    const group = isPhoto ? "photo" : "file";
    const fileDetails = [
      attachment.localPaste && "Local",
      attachment.pdf &&
        `${attachment.pdf.pageCount} ${attachment.pdf.pageCount === 1 ? "page" : "pages"}`,
      attachment.pdf &&
        attachment.status === "complete" &&
        attachment.pdf.pages.some((page) => page.status === "failed") &&
        "partial text",
      attachment.selectedPdfPages &&
        `Selected: ${formatPdfPageNumbers(attachment.selectedPdfPages)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    mediaTiles.set(
      `${group}:${attachment.clientId ?? `${attachment.name}:${index}`}`,
      <li
        className={
          isPhoto ? "spec400-attachment-chip" : "spec400-attachment-chip spec400-composer-card"
        }
        data-status={attachment.status}
        data-kind={attachment.kind}
      >
        <button
          type="button"
          className="spec400-chip-inspect"
          data-attachment-preview-trigger=""
          aria-label={`Inspect ${attachment.name}`}
          aria-description={attachment.pasteSummary}
          title={[
            attachment.pasteSummary ?? attachment.name,
            attachmentState(attachment),
            fileDetails,
          ]
            .filter(Boolean)
            .join(" · ")}
          onClick={(event) => {
            previewTriggerRef.current = event.currentTarget;
            previewReturnToInputRef.current = false;
            setPreviewOffset(0);
            setPreviewAttachment(attachment);
          }}
        >
          {isPhoto ? (
            <>
              {attachment.dataUrl && (
                <img
                  className="spec400-attachment-thumb"
                  src={attachment.dataUrl}
                  alt=""
                  decoding="async"
                  aria-hidden="true"
                />
              )}
              {attachment.status === "uploading" ? (
                <Loader2
                  className="spec400-attachment-image-state animate-spin"
                  aria-hidden="true"
                />
              ) : attachment.status === "failed" ? (
                <AlertCircle className="spec400-attachment-image-state" aria-hidden="true" />
              ) : null}
            </>
          ) : attachment.status === "uploading" ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : attachment.status === "failed" ? (
            <AlertCircle aria-hidden="true" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          {isPhoto ? (
            <span className="sr-only">{attachment.name}</span>
          ) : (
            <span className="spec400-chip-labels">
              <span className="spec400-chip-name">
                {attachment.pasteSummary ?? attachment.name}
              </span>
              {fileDetails && <small>{fileDetails}</small>}
            </span>
          )}
          <span className="sr-only">{attachmentState(attachment)}</span>
        </button>
        <button
          type="button"
          className="spec400-chip-remove"
          aria-label={`Remove ${attachment.name}`}
          onClick={() => removeAttachment(index)}
        >
          <X aria-hidden="true" />
        </button>
      </li>,
    );
  });
  if (pasteOffer) {
    mediaTiles.set(
      `file:pending:${pasteOffer.id}`,
      <li className="spec400-attachment-chip spec400-composer-card" data-status="pending">
        <button
          type="button"
          className="spec400-chip-inspect"
          data-attachment-preview-trigger=""
          aria-label="Inspect pending pasted text"
          aria-description={pasteOffer.summary}
          title={pasteOffer.summary}
          onClick={(event) => {
            previewTriggerRef.current = event.currentTarget;
            previewReturnToInputRef.current = false;
            setPreviewOffset(0);
            setPastePreviewOpen(true);
          }}
        >
          <FileText aria-hidden="true" />
          <span className="spec400-chip-labels">
            <span className="spec400-chip-name">{pasteOffer.summary}</span>
            <small>Not attached</small>
          </span>
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
      </li>,
    );
  }
  const linkCounts = new Map<string, number>();
  for (const link of previewLinks) {
    const occurrence = linkCounts.get(link.raw) ?? 0;
    linkCounts.set(link.raw, occurrence + 1);
    mediaTiles.set(
      `link:${link.raw}:${occurrence}`,
      <li className="spec400-composer-link spec400-composer-card">
        <LinkPreviewChip
          url={link.url}
          placement="composer"
          onRemove={() => {
            if (disabled) return;
            editComposerDraft(link.start, link.end, "");
            window.requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      </li>,
    );
  }
  // Preserve insertion order within each group while keeping photos at the front.
  const mediaContext = attachmentContextRef.current;
  const previousMediaOrder =
    mediaOrderRef.current?.context === mediaContext ? mediaOrderRef.current.keys : [];
  const mediaKeys = [
    ...previousMediaOrder.filter((key) => mediaTiles.has(key)),
    ...Array.from(mediaTiles.keys()).filter((key) => !previousMediaOrder.includes(key)),
  ];
  const mediaOrder = ["photo:", "file:", "link:"].flatMap((prefix) =>
    mediaKeys.filter((key) => key.startsWith(prefix)),
  );
  const photoCount = attachments.filter(
    (attachment) =>
      attachment.kind === "image" || (attachment.kind === "text_file" && attachment.localPaste),
  ).length;
  useEffect(() => {
    mediaOrderRef.current = { context: mediaContext, keys: mediaOrder };
  });

  return (
    <div
      className="spec400-chat-input"
      data-composer-surface={surface}
      data-voice-active={activeVoiceMode === "voice" || undefined}
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
      {templateFormat && !isStreaming && !disabled && !activeVoiceMode && (
        <ChatOutputTemplates
          key={templateFormat}
          format={templateFormat}
          userKey={user?.id ?? null}
          onClose={() => {
            setTemplateFormat(null);
            ref.current?.focus();
          }}
          onChoose={(template, instructions) => {
            const prompt = chatOutputPrompt(templateFormat, template, instructions);
            onChange(value.trim() ? `${value.trimEnd()}\n\n${prompt}` : prompt);
            setTemplateFormat(null);
            window.requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      )}
      {goalContext && (
        <ChatGoalRow
          principal={goalContext.principal}
          chatId={goalContext.chatId}
          editing={goalEditing}
          onEditingChange={setGoalEditing}
        />
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
        onVoicePlaybackProgress={onVoicePlaybackProgress}
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
      <div
        ref={composerAnchorRef}
        className="spec400-composer"
        hidden={activeVoiceMode === "dictate"}
        data-chat-image-context={attachmentContext}
        data-ui-reference="chatgpt-composer"
        data-has-draft={hasDraft ? "true" : "false"}
        data-long-draft={longDraft || undefined}
        data-focus-origin={composerFocusOrigin}
        onPointerDownCapture={() => setComposerFocusOrigin("pointer")}
        onKeyDownCapture={(event) => {
          if (event.key === "Tab") setComposerFocusOrigin("keyboard");
        }}
      >
        <div className="contents spec400-composer-content">
          {mediaOrder.length > 0 && (
            <ul
              className="spec400-composer-media"
              data-photo-count={photoCount}
              aria-label="Attachments"
            >
              {mediaOrder.map((key) => (
                <Fragment key={key}>{mediaTiles.get(key)}</Fragment>
              ))}
            </ul>
          )}
          <div className="spec400-input-region">
            <textarea
              ref={ref}
              value={editor.text}
              onChange={(event) => {
                setSlashDismissed(false);
                setSlashModels(false);
                setSlashIndex(0);
                updateComposerText(event.target.value, event.target.selectionStart);
              }}
              onKeyDown={handleKey}
              disabled={disabled}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              placeholder={placeholder ?? t("Work with KovaGPT")}
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
              <ExpandViewIcon />
            </button>
          </div>
          {pluginContexts.length > 0 && (
            <div className="spec400-plugin-tokens" role="group" aria-label="Selected plugins">
              {pluginContexts.map((plugin) => {
                const logo =
                  PLUGIN_BRAND_ASSET_URLS[plugin.id === "outlook-calendar" ? "outlook" : plugin.id];
                return (
                  <button
                    key={plugin.id}
                    type="button"
                    className="spec400-plugin-token"
                    disabled={disabled || isStreaming}
                    onClick={() => {
                      onPluginContextsChange?.(
                        pluginContexts.filter((item) => item.id !== plugin.id),
                      );
                      window.requestAnimationFrame(() => ref.current?.focus());
                    }}
                    aria-label={`Remove plugin ${plugin.label}`}
                    title={`Remove ${plugin.label} · Backspace or Delete removes the last selected plugin`}
                  >
                    {logo ? (
                      <img src={logo} alt="" aria-hidden="true" />
                    ) : (
                      <Plug aria-hidden="true" />
                    )}
                    <span>{plugin.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {projectContext && (
            <div
              className="spec400-inline-project-context flex min-w-0 flex-wrap gap-2 px-3"
              data-desktop-tray={showResources || undefined}
            >
              <button
                type="button"
                className="spec400-selected-tool min-w-0"
                disabled={isStreaming}
                onClick={() => onProjectContext?.(null)}
                aria-label={`Remove project ${projectContext.name}`}
              >
                <Folder aria-hidden="true" />
                <span className="truncate">{projectContext.name}</span>
                <X aria-hidden="true" />
              </button>
            </div>
          )}
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
        </div>
        <div className="spec400-composer-toolbar" role="group" aria-label="Message tools">
          <div className="spec400-composer-tools">
            <input
              ref={fileRef}
              aria-label="Choose files"
              disabled={disabled || isStreaming || !isLoaded || !user}
              type="file"
              accept="image/*,text/*,.pdf,.docx,.xlsx,.pptx,.excalidraw,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
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
              <Popover
                open={plusOpen}
                onOpenChange={(next) => {
                  setPlusOpen(next);
                  if (next) {
                    setResourceSection(null);
                    setSlashDismissed(true);
                  }
                }}
              >
                <PopoverAnchor virtualRef={composerAnchorRef} />
                <PopoverTrigger asChild>
                  <button
                    ref={plusTriggerRef}
                    type="button"
                    disabled={disabled || isStreaming}
                    className="spec400-toolbar-button spec400-toolbar-icon kova-composer-plus"
                    aria-label="Attach"
                    title="Add files and tools"
                    aria-haspopup="dialog"
                    aria-expanded={plusOpen}
                  >
                    <Plus aria-hidden="true" />
                    <span className="sr-only">Attach</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  ref={addMenuRef}
                  role="dialog"
                  aria-label={
                    phoneResourceSection === "files"
                      ? "Choose files"
                      : phoneResourceSection === "plugins"
                        ? "Choose plugins"
                        : "Attach files and tools"
                  }
                  className="kova-composer-menu spec400-attach-menu kova-composer-full-menu"
                  side={longDraft ? "top" : "bottom"}
                  align="start"
                  sideOffset={5}
                  collisionPadding={8}
                  onKeyDown={handleMenuKeyDown}
                  onOpenAutoFocus={(event) => {
                    if (isMobileLayout) event.preventDefault();
                  }}
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
                  {phoneResourceSection ? (
                    <>
                      <button
                        ref={resourceBackRef}
                        type="button"
                        className="kova-composer-action"
                        onClick={() => {
                          setResourceSection(null);
                          window.requestAnimationFrame(() =>
                            addMenuRef.current
                              ?.querySelector<HTMLButtonElement>(
                                `[data-composer-resource="${phoneResourceSection}"]`,
                              )
                              ?.focus(),
                          );
                        }}
                      >
                        <ChevronLeft aria-hidden="true" />
                        Back to files and tools
                      </button>
                      {renderComposerActions(isMobileLayout, phoneResourceSection)}
                    </>
                  ) : (
                    renderComposerActions(isMobileLayout)
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="spec400-composer-trailing">
            {userTier !== "free" &&
            canChangeAgent &&
            hostedModel &&
            onHostedModelChange &&
            mode &&
            onModeChange ? (
              <ConsumerModelSelector
                value={hostedModel}
                onChange={onHostedModelChange}
                recommendedSelection={recommendedModelSelection}
                mode={mode}
                onModeChange={onModeChange}
                tier={userTier}
                intelligenceOpen={mobileIntelligenceOpen}
                onIntelligenceOpenChange={setMobileIntelligenceOpen}
                disabled={disabled}
              />
            ) : canChangeAgent && mode && onModeChange ? (
              <ModelSelector
                mode={mode}
                onChange={onModeChange}
                userTier={userTier}
                modelLabel={
                  CONSUMER_MODELS.find(
                    (model) =>
                      model.id === (userTier === "free" ? DEFAULT_CONSUMER_MODEL : hostedModel),
                  )?.label
                }
                compact
              />
            ) : (
              <ComposerModelStatus visible={showModelStatus && isLoaded && Boolean(user)} />
            )}
            <div className="spec400-composer-speech-actions">
              <button
                type="button"
                ref={dictationTriggerRef}
                data-testid="dictate-button"
                className="spec400-toolbar-button spec400-toolbar-icon kova-dictation-button"
                aria-label="Type with voice"
                aria-controls="kova-inline-dictation"
                aria-expanded={activeVoiceMode === "dictate"}
                disabled={
                  disabled || isStreaming || !isLoaded || !online || activeVoiceMode === "voice"
                }
                title="Type with voice"
                onClick={(event) => openVoice("dictate", event.currentTarget)}
              >
                <Mic aria-hidden="true" />
                <span className="sr-only">Type with voice</span>
              </button>
              <button
                type="button"
                data-testid="voice-button"
                className="spec400-send-button spec400-primary-voice"
                hidden={activeVoiceMode !== "voice" && (hasDraft || isStreaming)}
                aria-label={activeVoiceMode === "voice" ? "Stop voice" : "Voice"}
                aria-controls={activeVoiceMode === "voice" ? "kova-inline-voice" : undefined}
                aria-expanded={activeVoiceMode === "voice"}
                disabled={
                  activeVoiceMode !== "voice" &&
                  (disabled ||
                    isStreaming ||
                    !isLoaded ||
                    !user ||
                    !online ||
                    !onVoiceSubmit ||
                    voiceOpeningBlocked)
                }
                title={
                  activeVoiceMode === "voice"
                    ? "Stop voice"
                    : onVoiceSubmit
                      ? "Start a voice conversation"
                      : "Voice conversations require a saved chat"
                }
                onClick={(event) => {
                  if (activeVoiceMode === "voice") setVoiceOpenMode(null);
                  else openVoice("voice", event.currentTarget);
                }}
              >
                {activeVoiceMode === "voice" ? (
                  <Square aria-hidden="true" />
                ) : (
                  <AudioLines aria-hidden="true" />
                )}
                {activeVoiceMode === "voice" && <span>Stop</span>}
              </button>
              {isStreaming && activeVoiceMode !== "voice" ? (
                <button
                  type="button"
                  onPointerDown={(event) => {
                    // Keep keyboard/viewport geometry stable until this click lands.
                    if (event.button === 0) event.preventDefault();
                  }}
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
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    event.preventDefault();
                    sendHoldConsumed.current = false;
                    cancelSendHold();
                    if (
                      event.pointerType !== "touch" ||
                      !paidModelPicker ||
                      !isLoaded ||
                      !user ||
                      !window.matchMedia("(max-width: 767px)").matches
                    )
                      return;
                    sendHold.current = {
                      x: event.clientX,
                      y: event.clientY,
                      timer: window.setTimeout(() => {
                        sendHold.current = null;
                        sendHoldConsumed.current = true;
                        setMobileIntelligenceOpen(true);
                      }, 500),
                    };
                  }}
                  onPointerMove={(event) => {
                    const hold = sendHold.current;
                    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) {
                      sendHoldConsumed.current = true;
                      cancelSendHold();
                    }
                  }}
                  onPointerUp={cancelSendHold}
                  onPointerCancel={cancelSendHold}
                  onPointerLeave={cancelSendHold}
                  onContextMenu={(event) => {
                    if (sendHold.current || sendHoldConsumed.current) event.preventDefault();
                  }}
                  disabled={!canSubmit}
                  onClick={(event) => {
                    if (event.detail > 0 && sendHoldConsumed.current) return;
                    triggerSubmit();
                  }}
                  className="spec400-send-button"
                  hidden={!hasDraft}
                  aria-label="Send message"
                  data-testid="send-button"
                  title={
                    disabled
                      ? "Messaging is unavailable"
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
      </div>
      <Popover
        open={slashOpen && !projectPickerOpen}
        onOpenChange={(next) => {
          if (!next) setSlashDismissed(true);
        }}
      >
        <PopoverAnchor virtualRef={composerAnchorRef} />
        <PopoverContent
          ref={slashListRef}
          className="kova-composer-menu kova-composer-full-menu"
          aria-label={slashModels ? "Choose Kova model" : "Chat commands"}
          role="group"
          side={surface === "conversation" || longDraft ? "top" : "bottom"}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === ref.current) event.preventDefault();
          }}
          onEscapeKeyDown={() => ref.current?.focus()}
          onKeyDown={handleMenuKeyDown}
        >
          {slashModels
            ? userTier === "free"
              ? modesForTier(userTier).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="kova-composer-action"
                    aria-pressed={mode === item.id}
                    disabled={!canChangeAgent || !onModeChange}
                    onClick={() => {
                      onModeChange?.(item.id);
                      onChange("");
                      setSlashModels(false);
                      ref.current?.focus();
                    }}
                  >
                    <Boxes aria-hidden="true" />
                    {item.id === "instant"
                      ? "KovaGPT Chat"
                      : item.id === "thinking"
                        ? "KovaGPT Thinking 4.2"
                        : item.label}
                  </button>
                ))
              : CONSUMER_MODELS.filter((item) => item.tiers.includes(userTier)).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="kova-composer-action"
                    aria-pressed={hostedModel === item.id}
                    disabled={!canChangeAgent || !onHostedModelChange}
                    onClick={() => {
                      onHostedModelChange?.(item.id);
                      onChange("");
                      setSlashModels(false);
                      ref.current?.focus();
                    }}
                  >
                    <Boxes aria-hidden="true" />
                    {item.label}
                  </button>
                ))
            : slashMatches.map(({ id, label, description, icon: Icon, ...option }, index) => (
                <button
                  key={id}
                  type="button"
                  className="kova-composer-action"
                  data-highlighted={index === slashIndex || undefined}
                  onClick={(event) => selectSlashCommand(id, event.currentTarget)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  <small>{description}</small>
                  {"submenu" in option ? (
                    <ChevronRight aria-hidden="true" className="ml-auto" />
                  ) : null}
                </button>
              ))}
        </PopoverContent>
      </Popover>
      <div
        className="kova-composer-tray"
        hidden={!showResources || activeVoiceMode === "dictate"}
        data-has-add-menu={showAddMenu || undefined}
        role="group"
        aria-label="Chat resources"
      >
        {showChooseProject && showAddMenu ? (
          <>
            <button
              type="button"
              className="kova-composer-tray-action"
              aria-expanded={projectPickerOpen && !startProjectChat}
              aria-haspopup="dialog"
              aria-label={
                projectContext ? `Selected project ${projectContext.name}` : "Choose project"
              }
              disabled={!user || disabled || isStreaming}
              onClick={(event) =>
                openProjectPicker(false, event.currentTarget, event.currentTarget)
              }
            >
              {projectContext ? (
                <Globe aria-hidden="true" className="spec400-selected-project-icon" />
              ) : (
                <Folder aria-hidden="true" />
              )}
              <span>{projectContext?.name ?? "Choose project"}</span>
            </button>
            {projectContext ? (
              <button
                type="button"
                className="kova-composer-tray-remove"
                disabled={isStreaming}
                aria-label={`Remove project ${projectContext.name}`}
                title={`Remove project ${projectContext.name}`}
                onClick={() => onProjectContext?.(null)}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : null}
        {showAddMenu
          ? (["files", "plugins"] as const).map((section) => (
              <Popover
                key={section}
                open={utilityMenu === section}
                onOpenChange={(next) =>
                  setUtilityMenu((current) =>
                    next ? section : current === section ? null : current,
                  )
                }
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="kova-composer-tray-action"
                    disabled={disabled || isStreaming}
                    aria-label={section === "files" ? "Files" : "Plugins"}
                    aria-haspopup="dialog"
                  >
                    {section === "files" ? (
                      <LibraryBig aria-hidden="true" />
                    ) : (
                      <Plug aria-hidden="true" />
                    )}
                    <span>{section === "files" ? "Files" : "Plugins"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  role="dialog"
                  aria-label={section === "files" ? "Choose files" : "Choose plugins"}
                  className="kova-composer-menu"
                  side="top"
                  align="start"
                  collisionPadding={12}
                  onCloseAutoFocus={(event) => {
                    if (
                      (utilityMenu && utilityMenu !== section) ||
                      libraryOpen ||
                      contextOpen ||
                      signInRequest
                    )
                      event.preventDefault();
                  }}
                >
                  {renderComposerActions(false, section)}
                </PopoverContent>
              </Popover>
            ))
          : null}
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
            disabled={disabled || (removedPaste?.pasted ? false : fileSlotsUsed(attachments) >= 2)}
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
                : previewAttachment?.pasted
                  ? "Pasted text. Sent with your message as part of the prompt; it is not uploaded as a file."
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
            ) : pasteEditDraft !== null && previewAttachment?.localPaste ? (
              <>
                <label className="sr-only" htmlFor="kova-pasted-text-editor">
                  Edit pasted text
                </label>
                <textarea
                  id="kova-pasted-text-editor"
                  className="kova-pasted-editor"
                  value={pasteEditDraft}
                  autoFocus
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) => setPasteEditDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      savePastedEdit();
                    }
                  }}
                />
                <p className="spec400-preview-range" aria-live="polite">
                  {pasteEditDraft.length.toLocaleString()} characters
                  {previewAttachment.pasted
                    ? ` of ${PASTED_TEXT_MAX_CHARACTERS.toLocaleString()}`
                    : ""}
                  . Press {"\u2318"}/Ctrl+Enter to save.
                </p>
              </>
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
            {previewAttachment?.localPaste && pasteEditDraft !== null && (
              <div className="spec400-dialog-footer">
                <button
                  type="button"
                  className="spec400-toolbar-button"
                  onClick={() => setPasteEditDraft(null)}
                >
                  Cancel edit
                </button>
                <button
                  type="button"
                  className="spec400-toolbar-button kova-pasted-save"
                  disabled={disabled || pasteEditDraft === previewAttachment.textContent}
                  onClick={savePastedEdit}
                >
                  Save changes
                </button>
              </div>
            )}
            {(pastePreviewOpen || previewAttachment?.localPaste) && pasteEditDraft === null && (
              <div className="spec400-dialog-footer">
                {previewAttachment?.localPaste && (
                  <button
                    type="button"
                    className="spec400-toolbar-button"
                    disabled={disabled}
                    onClick={() => setPasteEditDraft(previewAttachment.textContent ?? "")}
                  >
                    Edit text
                  </button>
                )}
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
                    disabled={disabled || !isLoaded || fileSlotsUsed(attachments) >= 2}
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
