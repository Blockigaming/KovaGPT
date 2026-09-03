import {
  ArrowUp,
  Paperclip,
  Telescope,
  Square,
  Plus,
  X,
  Image as ImageIcon,
  ImagePlus,
  Globe,
  FileText,
  Camera,
  Search,
  Sparkles,
  Brain,
  AlertCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useUser } from "@/components/auth/ClerkSafe";
import { useLayout } from "@/hooks/use-mobile";
import { useSharedSendOnEnter } from "@/lib/composer-preferences";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { tryUseUpload } from "@/lib/limits";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import { DAILY_UPLOAD_LIMIT_BY_TIER, type ModeId, type Tier } from "@/lib/modes";
import { shouldSubmitComposerOnEnter } from "@/lib/composer-keyboard.mjs";

export type PendingAttachment = {
  kind: "image" | "text_file" | "library_file";
  dataUrl: string;
  textContent?: string;
  name: string;
  size?: number;
  status?: "selected" | "uploading" | "complete" | "failed";
  error?: string;
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
export type ComposerToolId =
  "web_search" | "deep_research" | "image" | "study" | "data_analysis" | "file_analysis";

type ComposerAction = {
  id: ComposerToolId;
  label: string;
  icon: LucideIcon;
};

const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "deep_research", label: "Deep research", icon: Telescope },
  { id: "image", label: "Create Image", icon: ImagePlus },
];

const PROMPT_SHORTCUTS = [
  { label: "Brainstorm ideas", prompt: "Help me brainstorm ideas about " },
  { label: "Make a plan", prompt: "Create a practical step-by-step plan for " },
  {
    label: "Improve writing",
    prompt: "Help me rewrite this clearly while preserving the meaning:\n\n",
  },
] as const;

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
  isStreaming,

  sendOnEnter,

  disabled = false,
  showAddMenu = true,
  attachments,
  onAttachmentsChange,
  mode,
  onModeChange,
  userTier = "free",
  canChangeAgent = true,
  onUploadLimit,
  placeholder,
  onPromptShortcut,
  selectedTool,
  onToolSelect,
  recentLibraryFiles = [],
  recentLibraryLoading = false,
  recentLibraryError = null,
  onRecentLibraryRetry,
  surface = "conversation",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;

  /** Explicit override. When omitted, the current user's shared persisted preference is used. */
  sendOnEnter?: boolean;

  /** Disables text entry and submission without changing existing callers. */
  disabled?: boolean;
  /** Hides and disables attachments, tools, and prompt shortcuts. */
  showAddMenu?: boolean;
  attachments: PendingAttachment[];
  onAttachmentsChange: (a: PendingAttachment[]) => void;
  mode?: ModeId;
  onModeChange?: (m: ModeId) => void;
  userTier?: Tier;
  /** Guests use the basic agent and cannot change versions or reasoning levels. */
  canChangeAgent?: boolean;
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
  /** Controls whether the desktop add menu opens below the centered composer or above a docked one. */
  surface?: "empty" | "conversation";
}) {
  const { isDesktop, interaction } = useLayout();
  const { user } = useUser();
  const sharedSendOnEnter = useSharedSendOnEnter(user?.id ?? null);
  const effectiveSendOnEnter = sendOnEnter ?? sharedSendOnEnter;
  const isMobileLayout = !isDesktop;
  const isCoarsePointer = interaction === "touch";

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const plusTriggerRef = useRef<HTMLButtonElement>(null);

  const [plusOpen, setPlusOpen] = useState(false);
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineStatusSnapshot,
    getServerOnlineStatusSnapshot,
  );
  const [kbOffset, setKbOffset] = useState(0);
  const submittingRef = useRef(false);
  const composingRef = useRef(false);
  const [uploadAnnouncement, setUploadAnnouncement] = useState("");
  const [recentQuery, setRecentQuery] = useState("");
  useEffect(() => {
    if (!plusOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!plusWrapRef.current?.contains(target)) setPlusOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlusOpen(false);
        window.requestAnimationFrame(() => plusTriggerRef.current?.focus());
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [plusOpen]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

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

  const blockedAttachment = attachments.find(
    (attachment) => attachment.status === "uploading" || attachment.status === "failed",
  );
  const blockedAttachmentMessage = blockedAttachment
    ? blockedAttachment.status === "uploading"
      ? `Wait for ${blockedAttachment.name} to finish.`
      : `Remove or retry ${blockedAttachment.name} before sending.`
    : null;

  const triggerSubmit = () => {
    if (disabled || submittingRef.current || isStreaming) return;
    if (!online) return;
    if (!value.trim() && attachments.length === 0) return;
    if (blockedAttachmentMessage) {
      setUploadAnnouncement(blockedAttachmentMessage);
      toast.error(blockedAttachmentMessage);
      return;
    }
    submittingRef.current = true;
    setUploadAnnouncement("Message submitted");
    onSubmit();
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
      hasContent: Boolean(value.trim() || attachments.length > 0),
      disabled,
      isStreaming,
    });
    if (!shouldSubmit) return;
    e.preventDefault();
    triggerSubmit();
  };

  async function addFiles(files: File[]) {
    if (disabled || !showAddMenu || files.length === 0) return;
    const availableSlots = Math.max(0, 2 - attachments.length);
    if (availableSlots === 0) {
      setUploadAnnouncement("Remove an attachment before adding another.");
      toast.error("You can attach up to 2 files per message.");
      return;
    }
    if (files.length > availableSlots) {
      toast.message(
        `Only the first ${availableSlots} file${availableSlots === 1 ? "" : "s"} was added.`,
      );
    }
    let nextAttachments = [...attachments];
    const seen = new Set(nextAttachments.map((a) => `${a.name}:${a.size ?? 0}`));
    const uploadLimit = DAILY_UPLOAD_LIMIT_BY_TIER[userTier];

    for (const f of files.slice(0, availableSlots)) {
      const isImage = f.type.startsWith("image/");
      const isTextLike =
        f.type.startsWith("text/") || f.type === "application/json" || TEXT_LIKE_EXT.test(f.name);

      if (!isImage && !isTextLike) {
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
        if (!tryUseUpload(uploadLimit)) {
          onUploadLimit?.();
          break;
        }
        const uploading: PendingAttachment = {
          kind: "image",
          dataUrl: "",
          name: f.name,
          size: f.size,
          status: "uploading",
        };
        nextAttachments = [...nextAttachments, uploading];
        onAttachmentsChange(nextAttachments);
        setUploadAnnouncement(`Uploading ${f.name}`);
        try {
          const dataUrl = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = () => rej(new Error("Could not read image"));
            r.readAsDataURL(f);
          });
          nextAttachments = nextAttachments.map((a) =>
            a === uploading ? { ...uploading, dataUrl, status: "complete" as const } : a,
          );
          seen.add(duplicateKey);
          setUploadAnnouncement(`${f.name} attached`);
        } catch (error) {
          nextAttachments = nextAttachments.map((a) =>
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
        onAttachmentsChange(nextAttachments);
      } else {
        if (f.size > MAX_TEXT_FILE_BYTES) {
          nextAttachments = [
            ...nextAttachments,
            {
              kind: "text_file",
              dataUrl: "",
              name: f.name,
              size: f.size,
              fileType: f.type || "text/plain",
              status: "failed",
              error: "Text file is larger than 256 KB",
            },
          ];
          setUploadAnnouncement(`${f.name}: text file is larger than 256 KB`);
          continue;
        }
        if (!tryUseUpload(uploadLimit)) {
          onUploadLimit?.();
          break;
        }
        const uploading: PendingAttachment = {
          kind: "text_file",
          dataUrl: "",
          name: f.name,
          size: f.size,
          fileType: f.type || "text/plain",
          status: "uploading",
        };
        nextAttachments = [...nextAttachments, uploading];
        onAttachmentsChange(nextAttachments);
        setUploadAnnouncement(`Reading ${f.name}`);
        try {
          const textContent = await f.text();
          nextAttachments = nextAttachments.map((attachment) =>
            attachment === uploading
              ? { ...uploading, textContent, status: "complete" as const }
              : attachment,
          );
          seen.add(duplicateKey);
          setUploadAnnouncement(`${f.name} ready for analysis`);
        } catch (error) {
          nextAttachments = nextAttachments.map((attachment) =>
            attachment === uploading
              ? {
                  ...uploading,
                  status: "failed" as const,
                  error: error instanceof Error ? error.message : "Could not read file",
                }
              : attachment,
          );
          setUploadAnnouncement(`${f.name}: file could not be read`);
        }
        onAttachmentsChange(nextAttachments);
      }
    }
    if (nextAttachments !== attachments) onAttachmentsChange(nextAttachments);
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await addFiles(files);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    if (disabled || !showAddMenu) return;
    await addFiles(files);
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
    onAttachmentsChange([
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
    setUploadAnnouncement(`${name} attached from Library`);
    ref.current?.focus();
  };

  const visibleRecentLibraryFiles = recentLibraryFiles
    .filter((item) => {
      const q = recentQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (item.fileName || item.title).toLowerCase().includes(q) ||
        (item.fileType ?? "").toLowerCase().includes(q) ||
        (item.projectName ?? "").toLowerCase().includes(q)
      );
    })
    .slice(0, 8);

  const renderRecentLibraryFiles = () => (
    <div className="mt-1 border-t border-border/70 pt-1" aria-label="Recent Library files">
      <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Recent Library files
      </div>
      {recentLibraryFiles.length > 4 ? (
        <label className="mx-2 mb-1 block">
          <span className="sr-only">Search recent Library files</span>
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
        <div className="px-3 py-3 text-sm text-muted-foreground">No reusable files yet.</div>
      ) : (
        <div className="max-h-64 overflow-y-auto p-1">
          {visibleRecentLibraryFiles.map((item) => {
            const name = item.fileName || item.title;
            return (
              <button
                key={item.id}
                type="button"
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
    if (tool.id === "deep_research" && !user) {
      toast.message("Log in to use Deep research");
      setPlusOpen(false);
      return;
    }
    const next = selectedTool === tool.id ? null : tool.id;
    onToolSelect?.(next);
    setPlusOpen(false);
    setUploadAnnouncement(next ? `${tool.label} selected` : `${tool.label} removed`);
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const choosePromptShortcut = (label: string, prompt: string) => {
    onPromptShortcut?.(prompt);
    setPlusOpen(false);
    setUploadAnnouncement(`${label} added`);
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const renderComposerActions = (mobile: boolean) => {
    const rowClass = `flex w-full items-center gap-3 rounded-xl text-left transition-colors duration-150 hover:bg-accent active:bg-accent disabled:cursor-not-allowed disabled:opacity-50 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
      mobile ? "min-h-14 px-4 py-3 text-base" : "min-h-11 px-3 py-2.5 text-sm"
    }`;
    const iconClass = mobile
      ? "h-5 w-5 shrink-0 text-muted-foreground"
      : "h-4 w-4 shrink-0 text-muted-foreground";
    const webSearchTool = COMPOSER_TOOLS.find((tool) => tool.id === "web_search");
    const imageTool = COMPOSER_TOOLS.find((tool) => tool.id === "image");
    const deepResearchTool = COMPOSER_TOOLS.find((tool) => tool.id === "deep_research");

    const photosRow = (
      <button
        type="button"
        onClick={() => {
          setPlusOpen(false);
          photoRef.current?.click();
        }}
        className={rowClass}
      >
        <ImageIcon className={iconClass} />
        <span>Photos</span>
      </button>
    );

    const filesRow = (
      <button
        type="button"
        onClick={() => {
          setPlusOpen(false);
          fileRef.current?.click();
        }}
        className={rowClass}
      >
        <Paperclip className={iconClass} />
        <span>Files</span>
      </button>
    );

    const cameraRow = mobile ? (
      <button
        type="button"
        onClick={() => {
          setPlusOpen(false);
          cameraRef.current?.click();
        }}
        className={rowClass}
      >
        <Camera className={iconClass} />
        <span>Camera</span>
      </button>
    ) : null;

    const toolRow = (tool: ComposerAction) => {
      const Icon = tool.icon;
      const active = selectedTool === tool.id;
      return (
        <button
          key={tool.id}
          type="button"
          aria-pressed={active}
          disabled={disabled || isStreaming}
          onClick={() => chooseTool(tool)}
          className={`kova-tool-button ${rowClass} ${active ? "bg-accent text-foreground" : ""}`}
        >
          <Icon className={iconClass} />
          <span>{tool.label}</span>
        </button>
      );
    };

    if (!user) {
      const lockedRow = (
        key: string,
        Icon: React.ComponentType<{ className?: string }>,
        label: string,
      ) => (
        <div
          key={key}
          aria-disabled="true"
          className={`kova-composer-locked ${rowClass} cursor-not-allowed text-muted-foreground hover:bg-transparent active:bg-transparent`}
        >
          <Icon className={`${iconClass} opacity-70`} />
          <span className="opacity-70">{label}</span>
        </div>
      );
      return (
        <>
          {photosRow}
          {filesRow}
          {cameraRow}
          {webSearchTool ? toolRow(webSearchTool) : null}
          <p className={`pt-3 pb-1 text-sm text-muted-foreground ${mobile ? "px-4" : "px-3"}`}>
            Log in to use...
          </p>
          {lockedRow("locked-deep-research", deepResearchTool?.icon ?? Telescope, "Deep research")}
          {lockedRow("locked-image", imageTool?.icon ?? ImageIcon, "Create image")}
          <button
            type="button"
            className={rowClass}
            onClick={() => {
              window.location.href = "/apps";
            }}
          >
            <Sparkles className={iconClass} />
            <span>Explore Apps and connectors</span>
          </button>
        </>
      );
    }

    return (
      <>
        {photosRow}
        {filesRow}
        {cameraRow}
        {COMPOSER_TOOLS.filter((tool) => tool.id !== "deep_research" || userTier !== "free").map(
          toolRow,
        )}
        <button type="button" className={rowClass} onClick={() => (window.location.href = "/apps")}>
          <Sparkles className={iconClass} />
          <span>Apps and connectors</span>
        </button>
      </>
    );
  };

  return (
    <div
      className="kova-chat-input w-full px-2.5 pb-[max(.75rem,var(--safe-bottom))] pt-2 transition-[padding] duration-150 sm:px-0"
      data-composer-surface={surface}
      style={isMobileLayout && kbOffset > 0 ? { paddingBottom: `${kbOffset + 8}px` } : undefined}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="mx-auto max-w-[48rem]">
        {!online ? (
          <p role="status" className="pb-2 text-center text-xs text-destructive">
            Reconnect to send
          </p>
        ) : null}
        <span className="sr-only">Drop files to attach</span>
        <div
          tabIndex={-1}
          className={`kova-composer overflow-visible ${isStreaming ? "is-streaming" : ""}`}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 pb-0" aria-label="Attachments">
              {attachments.map((a, i) => (
                <div
                  key={`${a.name}:${a.size ?? i}:${i}`}
                  className="relative min-h-16 w-24 overflow-hidden rounded-xl border border-border/70 bg-muted/45 shadow-sm"
                >
                  {a.kind === "library_file" ? (
                    <div className="flex h-16 w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <FileText className="h-5 w-5" />
                      <span className="text-[9px] uppercase">Library</span>
                    </div>
                  ) : a.kind === "text_file" ? (
                    <div className="flex h-16 w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <FileText className="h-5 w-5" />
                      <span className="text-[9px] uppercase">
                        {a.status === "complete" ? "Ready" : "File"}
                      </span>
                    </div>
                  ) : a.dataUrl ? (
                    <img
                      src={a.dataUrl}
                      alt={`Attachment preview: ${a.name}`}
                      className="h-16 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-full items-center justify-center text-muted-foreground">
                      {a.status === "failed" ? (
                        <AlertCircle className="h-5 w-5" />
                      ) : (
                        <FileText className="h-5 w-5" />
                      )}
                    </div>
                  )}
                  <div className="truncate px-1.5 pb-1 text-[10px] text-muted-foreground">
                    {a.name}
                  </div>
                  {a.kind === "library_file" && a.sourceProject ? (
                    <div className="truncate px-1.5 pb-1 text-[9px] text-muted-foreground">
                      {a.sourceProject}
                    </div>
                  ) : null}
                  {a.status === "uploading" ? (
                    <span className="absolute inset-x-1 bottom-5 h-1 overflow-hidden rounded-full bg-background/70">
                      <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
                    </span>
                  ) : null}
                  {a.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        onAttachmentsChange(attachments.filter((_, j) => j !== i));
                        fileRef.current?.click();
                      }}
                      className="absolute bottom-5 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 hover:bg-background"
                      aria-label={`Retry ${a.name}`}
                      title={a.error ?? "Retry attachment"}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onAttachmentsChange(attachments.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/85 hover:bg-background"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {showAddMenu && selectedToolOption && ActiveToolIcon && onToolSelect ? (
            <div className="flex px-3 pt-2">
              <button
                ref={plusTriggerRef}
                type="button"
                disabled={disabled || isStreaming}
                onClick={() => chooseTool(selectedToolOption)}
                className="kova-tool-button flex h-8 items-center gap-2 rounded-xl bg-accent px-2.5 text-xs font-medium text-foreground transition hover:bg-accent/80 disabled:opacity-60"
                aria-label={`Remove ${selectedToolOption.label}`}
              >
                <ActiveToolIcon className="h-3.5 w-3.5" />
                <span>{selectedToolOption.label}</span>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : null}
          <div aria-live="polite" className="sr-only">
            {uploadAnnouncement}
          </div>
          <div className="kova-composer-row flex items-end">
            <div
              className={`${showAddMenu ? "flex" : "hidden"} kova-composer-leading relative self-end items-center`}
              ref={plusWrapRef}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*,text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <span className="sr-only" id="file-upload-guidance">
                Text, code, CSV, JSON, and image files. Text files may be up to 256 KB and images up
                to 3 MB.
              </span>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => setPlusOpen((v) => !v)}
                disabled={disabled || isStreaming}
                className={`kova-composer-button kova-attach-button flex items-center justify-center rounded-full ${plusOpen && !isMobileLayout ? "is-open" : ""}`}
                aria-label="Add files, tools, or prompts"
                aria-haspopup="dialog"
                aria-expanded={plusOpen}
                title="Add"
              >
                <Plus className="kova-attach-icon" strokeWidth={2} />
              </button>
              {plusOpen && !isMobileLayout && (
                <div
                  role="dialog"
                  aria-label="Add files, tools, or prompts"
                  className={`kova-composer-menu kova-glass absolute left-0 z-50 max-h-[70vh] min-w-[280px] overflow-y-auto rounded-2xl p-1.5 animate-in fade-in ${
                    surface === "empty"
                      ? "top-[calc(100%+1.25rem)] origin-top-left"
                      : "bottom-[calc(100%+1.25rem)] origin-bottom-left"
                  }`}
                >
                  {renderComposerActions(false)}
                </div>
              )}
            </div>
            {showAddMenu && isMobileLayout && (
              <MobileBottomSheet
                open={plusOpen}
                onOpenChange={setPlusOpen}
                title="Add to your message"
                ariaLabel="Add files, tools, or prompts"
              >
                <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-1">
                  {renderComposerActions(true)}
                </div>
              </MobileBottomSheet>
            )}

            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              onKeyDown={handleKey}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              placeholder={placeholder ?? "Ask anything"}
              rows={1}
              spellCheck
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              className="kova-composer-input max-h-[200px] flex-1 resize-none overflow-y-auto border-0 bg-transparent text-foreground outline-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
              aria-label="Message KovaGPT"
              aria-keyshortcuts={
                effectiveSendOnEnter && !isMobileLayout && !isCoarsePointer
                  ? "Enter Control+Enter Meta+Enter"
                  : "Control+Enter Meta+Enter"
              }
            />
            <div className="kova-composer-trailing flex self-end items-center">
              {canChangeAgent && mode && onModeChange && (
                <div className="flex items-center">
                  <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
                </div>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="kova-composer-button kova-send-button is-enabled flex items-center justify-center rounded-full active:scale-90"
                  aria-label="Stop generating"
                  data-testid="stop-button"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : !disabled &&
                (value.trim() || attachments.length > 0) &&
                !blockedAttachmentMessage ? (
                <button
                  type="button"
                  onClick={triggerSubmit}
                  className="kova-composer-button kova-send-button is-enabled flex items-center justify-center rounded-full"
                  aria-label="Send message"
                  data-testid="send-button"
                >
                  <ArrowUp className="kova-send-icon" strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled || (!value.trim() && attachments.length === 0)}
                  aria-disabled={blockedAttachmentMessage ? true : undefined}
                  onClick={blockedAttachmentMessage ? triggerSubmit : undefined}
                  className="kova-composer-button kova-send-button flex items-center justify-center rounded-full"
                  aria-label={blockedAttachmentMessage ?? "Send message"}
                  data-testid="send-button"
                  title={
                    disabled
                      ? "Messaging is unavailable"
                      : (blockedAttachmentMessage ?? "Type a message to send")
                  }
                >
                  <ArrowUp className="kova-send-icon" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        KovaGPT can make mistakes. Check important information.
      </p>
    </div>
  );
}
