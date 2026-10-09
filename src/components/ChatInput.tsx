import {
  ArrowUp,
  Paperclip,
  Square,
  Plus,
  X,
  Image as ImageIcon,
  ImagePlus,
  Globe,
  FileText,
  Camera,
  LibraryBig,
  Pencil,
  AlertCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useLibraryAttachmentAutoSave } from "@/hooks/use-library-attachment-auto-save";
import { useLayout } from "@/hooks/use-mobile";
import { useSharedSendOnEnter } from "@/lib/composer-preferences";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { tryUseUpload } from "@/lib/limits";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import { DAILY_UPLOAD_LIMIT_BY_TIER, type ModeId, type Tier } from "@/lib/modes";
import { shouldSubmitComposerOnEnter } from "@/lib/composer-keyboard.mjs";
import type { ComposerToolId } from "@/lib/chat-store";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ComposerDrawingDialog } from "@/components/ComposerDrawingDialog";
import { ComposerPluginList } from "@/components/ComposerPluginList";

const ComposerPasteOffer = lazy(() => import("@/components/ComposerPasteOffer"));

export type PendingAttachment = {
  clientId?: string;
  source?: "file_upload" | "library";
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
  isStreaming,

  sendOnEnter,

  disabled = false,
  showAddMenu = true,
  saveAttachmentsToLibrary = false,
  attachments,
  onAttachmentsChange,
  mode,
  onModeChange,
  userTier = "free",
  canChangeAgent = true,
  onUploadLimit,
  placeholder,
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
  onSubmit: (tool?: ComposerToolId | null) => void | Promise<unknown>;
  onStop: () => void;
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
  const { user, isLoaded } = useUser();
  const attachmentAutoSave = useLibraryAttachmentAutoSave(
    saveAttachmentsToLibrary && isLoaded && !disabled,
    user?.id ?? null,
  );
  const pasteGenerationRef = useRef(0);
  const [pasteOffer, setPasteOffer] = useState<{
    text: string;
    original: string;
    start: number;
    end: number;
    attachedId?: string;
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
  }, [attachmentAutoSave.scope]);
  useEffect(() => {
    if (
      pasteOffer?.attachedId &&
      !attachments.some((item) => item.clientId === pasteOffer.attachedId)
    )
      setPasteOffer(null);
  }, [attachments, pasteOffer]);
  const documentReadsRef = useRef(new Set<AbortController>());
  const documentReadIdsRef = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const controller of documentReadsRef.current) controller.abort();
      documentReadsRef.current.clear();
    },
    [attachmentAutoSave.scope],
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
  const selectedToolRef = useRef(selectedTool);
  selectedToolRef.current = selectedTool;

  const [plusOpen, setPlusOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineStatusSnapshot,
    getServerOnlineStatusSnapshot,
  );
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
      el.style.height = "0px";
      const height = Math.min(Math.max(el.scrollHeight, 28), 200);
      el.style.height = `${height}px`;
      el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
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

  async function addFiles(files: File[]): Promise<boolean> {
    if (disabled || !showAddMenu || files.length === 0) return false;
    if (uploadBatchRef.current) {
      toast.message("Wait for the current files to finish before adding more.");
      return false;
    }
    const readScope = attachmentAutoSave.scope;
    const currentRead = () => attachmentScopeRef.current === readScope;
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
      const uploadLimit = DAILY_UPLOAD_LIMIT_BY_TIER[userTier];

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
          if (!tryUseUpload(uploadLimit)) {
            onUploadLimit?.();
            break;
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
          if (!tryUseUpload(uploadLimit)) {
            onUploadLimit?.();
            break;
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
    const id = attachments[index]?.clientId;
    if (id) documentReadIdsRef.current.get(id)?.abort();
    updateAttachments(attachments.filter((_, position) => position !== index));
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await addFiles(files);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const generation = ++pasteGenerationRef.current;
    const files = Array.from(e.clipboardData.files || []);
    if (files.length === 0) {
      const plain = e.clipboardData.getData("text/plain");
      const html = e.clipboardData.getData("text/html");
      if (disabled || (plain.length <= 10_000 && !html)) return;
      e.preventDefault();
      const scope = attachmentScopeRef.current;
      const original = value,
        start = ref.current?.selectionStart ?? value.length,
        end = ref.current?.selectionEnd ?? value.length;
      try {
        const { prepareComposerPaste } = await import("@/lib/composer-paste");
        const text = prepareComposerPaste(plain, html);
        if (attachmentScopeRef.current !== scope || generation !== pasteGenerationRef.current)
          return;
        setPasteOffer({ text, original, start, end });
      } catch (error) {
        if (attachmentScopeRef.current === scope)
          toast.error(error instanceof Error ? error.message : "Paste could not be prepared.");
      }
      return;
    }
    e.preventDefault();
    if (disabled || !showAddMenu) return;
    await addFiles(files);
  };

  const attachPaste = () => {
    if (!pasteOffer || disabled || !showAddMenu || attachments.length >= 2) {
      toast.error("Remove an attachment before attaching pasted text.");
      return;
    }
    if (!tryUseUpload(DAILY_UPLOAD_LIMIT_BY_TIER[userTier])) {
      onUploadLimit?.();
      return;
    }
    const id = crypto.randomUUID();
    updateAttachments([
      ...attachments,
      {
        clientId: id,
        source: "file_upload",
        kind: "text_file",
        dataUrl: "",
        textContent: pasteOffer.text,
        name: "Pasted-text.md",
        fileType: "text/markdown",
        size: new TextEncoder().encode(pasteOffer.text).length,
        status: "complete",
      },
    ]);
    setPasteOffer({ ...pasteOffer, attachedId: id });
  };
  const pasteIntoMessage = () => {
    if (!pasteOffer || disabled) return;
    const current = composerStateRef.current;
    if (pasteOffer.attachedId)
      updateAttachments(
        current.attachments.filter((item) => item.clientId !== pasteOffer.attachedId),
      );
    onChange(
      current.value === pasteOffer.original
        ? current.value.slice(0, pasteOffer.start) +
            pasteOffer.text +
            current.value.slice(pasteOffer.end)
        : current.value + (current.value ? "\n\n" : "") + pasteOffer.text,
    );
    setPasteOffer(null);
    ref.current?.focus();
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
    const next = selectedTool === tool.id ? null : tool.id;
    selectedToolRef.current = next;
    onToolSelect?.(next);
    setPlusOpen(false);
    setUploadAnnouncement(next ? `${tool.label} selected` : `${tool.label} removed`);
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const renderComposerActions = (mobile: boolean) => {
    const rowClass = "kova-composer-action";
    const pickFile = (input: React.RefObject<HTMLInputElement | null>) => {
      setPlusOpen(false);
      input.current?.click();
    };
    const imageTool = COMPOSER_TOOLS.find((tool) => tool.id === "image")!;
    return (
      <>
        <div className="kova-composer-primary-actions" aria-label="Attachment options">
          <button type="button" className={rowClass} onClick={() => pickFile(photoRef)}>
            <ImageIcon aria-hidden="true" />
            <span>Photos</span>
          </button>
          {mobile && (
            <button type="button" className={rowClass} onClick={() => pickFile(cameraRef)}>
              <Camera aria-hidden="true" />
              <span>Camera</span>
            </button>
          )}
          <button type="button" className={rowClass} onClick={() => pickFile(fileRef)}>
            <Paperclip aria-hidden="true" />
            <span>Files</span>
          </button>
          <button
            type="button"
            className={rowClass}
            onClick={() => {
              setPlusOpen(false);
              setLibraryOpen(true);
              if (user) onRecentLibraryRetry?.();
            }}
          >
            <LibraryBig aria-hidden="true" />
            <span>Library</span>
          </button>
          {!mobile && (
            <>
              <button
                type="button"
                className={rowClass}
                onClick={() => {
                  setPlusOpen(false);
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
                disabled={!user || !onToolSelect || disabled || isStreaming}
                title={
                  !user
                    ? "Log in to create images"
                    : !onToolSelect
                      ? "Image creation is unavailable in this conversation"
                      : "Create an image in this chat"
                }
                onClick={() => chooseTool(imageTool)}
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
        {!mobile && (
          <ComposerPluginList
            userId={isLoaded ? (user?.id ?? null) : null}
            authLoaded={isLoaded}
            onNavigate={() => setPlusOpen(false)}
          />
        )}
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
        {pasteOffer && (
          <Suspense fallback={null}>
            <ComposerPasteOffer
              text={pasteOffer.text}
              attached={Boolean(pasteOffer.attachedId)}
              onAttach={attachPaste}
              onPaste={pasteIntoMessage}
              onCancel={() => setPasteOffer(null)}
            />
          </Suspense>
        )}
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
                        removeAttachment(i);
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
                    onClick={() => removeAttachment(i)}
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
                type="button"
                disabled={disabled || isStreaming}
                onClick={() => chooseTool(selectedToolOption)}
                className="kova-tool-button flex h-8 items-center gap-2 rounded-full border border-border bg-transparent px-2.5 text-xs font-medium text-foreground transition disabled:opacity-60"
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
            >
              <input
                ref={fileRef}
                aria-label="Choose files"
                type="file"
                accept="image/*,text/*,.pdf,.docx,.xlsx,.pptx,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <span className="sr-only" id="file-upload-guidance">
                Text and code up to 256 KB, images up to 3 MB, and PDF or Office documents up to 10
                MB. Up to two files per message.
              </span>
              <input
                ref={photoRef}
                aria-label="Choose photos"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <input
                ref={cameraRef}
                aria-label="Take a photo"
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onFileChange}
              />
              <Popover open={plusOpen && !isMobileLayout} onOpenChange={setPlusOpen}>
                <PopoverTrigger asChild>
                  <button
                    ref={plusTriggerRef}
                    type="button"
                    disabled={disabled || isStreaming}
                    className={`kova-composer-button kova-attach-button flex items-center justify-center rounded-full ${plusOpen && !isMobileLayout ? "is-open" : ""}`}
                    aria-label="Add files, tools, or prompts"
                    aria-haspopup="dialog"
                    aria-expanded={plusOpen}
                    title="Add"
                  >
                    <Plus className="kova-attach-icon" strokeWidth={2} />
                  </button>
                </PopoverTrigger>
                {!isMobileLayout && (
                  <PopoverContent
                    role="dialog"
                    aria-label="Add files, tools, or prompts"
                    className="kova-composer-menu"
                    side={surface === "empty" ? "bottom" : "top"}
                    align="start"
                    sideOffset={10}
                    collisionPadding={12}
                    onCloseAutoFocus={(event) => {
                      if (libraryOpen || drawingOpen) event.preventDefault();
                    }}
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      const controls = Array.from(
                        event.currentTarget.querySelectorAll<HTMLElement>(
                          "button:not(:disabled),a[href]",
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
                            : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) %
                              controls.length;
                      controls[next]?.focus();
                    }}
                  >
                    {renderComposerActions(false)}
                  </PopoverContent>
                )}
              </Popover>
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
              enterKeyHint={
                effectiveSendOnEnter && !isMobileLayout && !isCoarsePointer ? "send" : "enter"
              }
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
      <ComposerDrawingDialog
        open={drawingOpen}
        onOpenChange={setDrawingOpen}
        onAttach={addFiles}
        onReturnFocus={() => ref.current?.focus()}
      />
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        KovaGPT can make mistakes. Check important information.
      </p>
    </div>
  );
}
