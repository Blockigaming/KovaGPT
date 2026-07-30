import {
  ArrowUp,
  Square,
  Plus,
  X,
  Image as ImageIcon,
  FileText,
  Camera,
  Puzzle,
  Search,
  Lightbulb,
  Sparkles,
  GraduationCap,
  SlidersHorizontal,
  Brain,
  AlertCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { useLayout } from "@/hooks/use-mobile";

import { useEffect, useRef, useState } from "react";
import { tryUseUpload, DAILY_UPLOAD_LIMIT, getUsage } from "@/lib/limits";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

export type PendingAttachment = {
  kind: "image" | "library_file";
  dataUrl: string;
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

const TEXT_LIKE_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|sh|bash|zsh|fish|env|ini|conf|log|srt|vtt)$/i;
const MAX_TEXT_FILE_BYTES = 256 * 1024; // 256 KB inline cap to keep prompts reasonable
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB image preview cap

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  attachments,
  onAttachmentsChange,
  mode,
  onModeChange,
  userTier = "free",
  onUploadLimit,
  placeholder,
  onPromptShortcut,
  onToolSelect,
  recentLibraryFiles = [],
  recentLibraryLoading = false,
  recentLibraryError = null,
  onRecentLibraryRetry,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  attachments: PendingAttachment[];
  onAttachmentsChange: (a: PendingAttachment[]) => void;
  mode?: ModeId;
  onModeChange?: (m: ModeId) => void;
  userTier?: Tier;
  /** Called when the user hits their daily upload quota. */
  onUploadLimit?: () => void;
  placeholder?: string;
  onPromptShortcut?: (prompt: string) => void;
  onToolSelect?: (tool: ComposerToolId) => void;
  recentLibraryFiles?: RecentLibraryFile[];
  recentLibraryLoading?: boolean;
  recentLibraryError?: string | null;
  onRecentLibraryRetry?: () => void;
}) {
  const { isDesktop } = useLayout();
  const isMobileLayout = !isDesktop;

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const toolsWrapRef = useRef<HTMLDivElement>(null);

  const [sendFlash, setSendFlash] = useState(false);
  const [actionColor, setActionColor] = useState<string>("#3b82f6");
  const [plusOpen, setPlusOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  const submittingRef = useRef(false);
  const composingRef = useRef(false);
  const [uploadAnnouncement, setUploadAnnouncement] = useState("");
  const [recentQuery, setRecentQuery] = useState("");

  useEffect(() => {
    if (!plusOpen && !toolsOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!plusWrapRef.current?.contains(target)) setPlusOpen(false);
      if (!toolsWrapRef.current?.contains(target)) setToolsOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlusOpen(false);
        setToolsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [plusOpen, toolsOpen]);

  useEffect(() => {
    try {
      const c = localStorage.getItem("kova-action-color");
      if (c && /^#[0-9a-f]{6}$/i.test(c)) setActionColor(c);
    } catch {
      /* ignore */
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "kova-action-color" && e.newValue && /^#[0-9a-f]{6}$/i.test(e.newValue)) {
        setActionColor(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    const onLocal = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (typeof ce.detail === "string" && /^#[0-9a-f]{6}$/i.test(ce.detail))
        setActionColor(ce.detail);
    };
    window.addEventListener("kova-action-color", onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("kova-action-color", onLocal as EventListener);
    };
  }, []);

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

  const triggerSubmit = () => {
    if (submittingRef.current || isStreaming) return;
    if (!value.trim() && attachments.length === 0) return;
    submittingRef.current = true;
    setSendFlash(true);
    setUploadAnnouncement("Message submitted");
    window.setTimeout(() => setSendFlash(false), 380);
    onSubmit();
  };

  const shortcutActions = [
    {
      label: "Search",
      icon: Search,
      prompt: "Search the web and cite sources for this: ",
    },
    {
      label: "Reason",
      icon: Lightbulb,
      prompt: "Think step by step and solve this carefully: ",
    },
    {
      label: "Create image",
      icon: Sparkles,
      prompt: "Create an image prompt for: ",
    },
    {
      label: "Study",
      icon: GraduationCap,
      prompt: "Tutor me on this topic with examples and a short quiz: ",
    },
  ];

  const toolActions: Array<{
    id: ComposerToolId;
    label: string;
    icon: LucideIcon;
    prompt: string;
  }> = [
    {
      id: "web_search",
      label: "Search the web",
      icon: Search,
      prompt: "Search the web and cite sources for: ",
    },
    {
      id: "deep_research",
      label: "Deep research",
      icon: GraduationCap,
      prompt: "Research this deeply with sources and a structured report: ",
    },
    { id: "image", label: "Create an image", icon: ImageIcon, prompt: "Create an image of: " },
    {
      id: "data_analysis",
      label: "Analyze data",
      icon: Brain,
      prompt: "Analyze this data and show the key findings: ",
    },
    {
      id: "study",
      label: "Study mode",
      icon: Lightbulb,
      prompt: "Tutor me on this step by step, then quiz me: ",
    },
    {
      id: "file_analysis",
      label: "Analyze files",
      icon: FileText,
      prompt: "Analyze the attached file and summarize the important details.",
    },
  ];

  const applyShortcut = (prompt: string) => {
    onPromptShortcut?.(prompt);
    if (!value.trim()) onChange(prompt);
    setToolsOpen(false);
    ref.current?.focus();
  };

  const applyTool = (tool: ComposerToolId, prompt: string) => {
    onToolSelect?.(tool);
    applyShortcut(prompt);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (e.key === "Enter" && !e.shiftKey && !native.isComposing && !composingRef.current) {
      e.preventDefault();
      triggerSubmit();
    }
  };

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    let nextValue = value;
    let nextAttachments = [...attachments];
    const seen = new Set(nextAttachments.map((a) => `${a.name}:${a.size ?? 0}`));

    for (const f of files) {
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
      if (isImage && seen.has(duplicateKey)) {
        setUploadAnnouncement(`${f.name} is already attached`);
        toast.message(`${f.name} is already attached.`);
        continue;
      }

      const u = getUsage();
      if (u.uploads >= DAILY_UPLOAD_LIMIT || !tryUseUpload()) {
        onUploadLimit?.();
        return;
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
              error: "Image is larger than 10 MB",
            },
          ];
          setUploadAnnouncement(`${f.name}: image is larger than 10 MB`);
          continue;
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
          toast.error(`${f.name} is too large (max 256 KB for text files).`);
          setUploadAnnouncement(`${f.name}: text file is larger than 256 KB`);
          continue;
        }
        const text = await f.text();
        const lang = (f.name.split(".").pop() || "").toLowerCase();
        const block = `\n\nAttached file: ${f.name}\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        nextValue = (nextValue ? nextValue : "") + block;
        setUploadAnnouncement(`${f.name} inserted into the message`);
      }
    }
    if (nextAttachments !== attachments) onAttachmentsChange(nextAttachments);
    if (nextValue !== value) onChange(nextValue);
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
    await addFiles(files);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  };

  const attachLibraryFile = (item: RecentLibraryFile) => {
    const name = item.fileName || item.title;
    const duplicate = attachments.some((a) => a.libraryItemId === item.id);
    if (duplicate) {
      setUploadAnnouncement(`${name} is already attached`);
      toast.message(`${name} is already attached.`);
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
                role="menuitem"
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

  return (
    <div
      className="w-full px-2.5 pb-[max(.75rem,var(--safe-bottom))] pt-2 transition-[padding] duration-150 sm:px-6 lg:px-8"
      style={isMobileLayout && kbOffset > 0 ? { paddingBottom: `${kbOffset + 8}px` } : undefined}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="mx-auto max-w-[48rem]">
        <div
          style={
            sendFlash
              ? ({
                  boxShadow: `0 0 0 2px ${actionColor}33`,
                  borderColor: `${actionColor}99`,
                } as React.CSSProperties)
              : undefined
          }
          className={`kova-composer kova-glass overflow-visible rounded-xl transition-[border-color,box-shadow,transform] duration-200 focus-within:border-foreground/20 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_12%,transparent)] ${
            sendFlash
              ? "scale-[0.995]"
              : isStreaming
                ? "border-foreground/40 ring-1 ring-foreground/10"
                : "border-border"
          }`}
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
          <div aria-live="polite" className="sr-only">
            {uploadAnnouncement}
          </div>
          <div className="flex min-h-[58px] items-end">
            <div className="flex items-center pl-1.5 relative" ref={plusWrapRef}>
              <input
                ref={fileRef}
                type="file"
                accept="text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
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
                className={`kova-attach-button w-11 h-11 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 active:scale-95 transition ${plusOpen && !isMobileLayout ? "rotate-45 text-foreground" : ""}`}
                aria-label="Attach"
                aria-haspopup="menu"
                aria-expanded={plusOpen}
                title="Add"
              >
                <Plus className="w-5 h-5 transition-transform" />
              </button>
              {plusOpen && !isMobileLayout && (
                <div
                  role="menu"
                  className="kova-glass absolute bottom-11 left-0 z-50 min-w-[220px] rounded-xl p-1.5 animate-in fade-in slide-in-from-bottom-1"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      cameraRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span>Camera</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      photoRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                    <span>Photos</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      window.location.href = "/apps";
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <Puzzle className="w-4 h-4 text-muted-foreground" />
                    <span>Plugins</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span>Files</span>
                  </button>
                  {renderRecentLibraryFiles()}
                </div>
              )}
            </div>
            {isMobileLayout && (
              <MobileBottomSheet
                open={plusOpen}
                onOpenChange={setPlusOpen}
                title="Attach"
                ariaLabel="Attach media or files"
              >
                <div className="flex flex-col gap-1 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      cameraRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-4 min-h-14 rounded-xl text-base hover:bg-accent active:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <Camera className="w-5 h-5 text-muted-foreground" />
                    <span>Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      photoRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-4 min-h-14 rounded-xl text-base hover:bg-accent active:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                    <span>Photos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-4 min-h-14 rounded-xl text-base hover:bg-accent active:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <span>Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      window.location.href = "/apps";
                    }}
                    className="w-full flex items-center gap-3 px-4 py-4 min-h-14 rounded-xl text-base hover:bg-accent active:bg-accent text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  >
                    <Puzzle className="w-5 h-5 text-muted-foreground" />
                    <span>Plugins</span>
                  </button>
                  {renderRecentLibraryFiles()}
                </div>
              </MobileBottomSheet>
            )}

            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKey}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              placeholder={placeholder ?? "Message KovaGPT"}
              rows={1}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-h-[44px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-[.72rem] text-[16px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0 lg:text-[15px]"
              aria-label="Message KovaGPT"
            />
            <div className="flex items-center gap-1.5 pr-1.5">
              {mode && onModeChange && (
                <div className="hidden lg:flex items-center">
                  <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
                </div>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  style={{ backgroundColor: "var(--kova-blue)" }}
className="kova-send-button mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-white transition hover:opacity-80 lg:h-9 lg:w-9"
                  aria-label="Stop"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : value.trim() || attachments.length > 0 ? (
                <button
                  type="button"
                  onClick={triggerSubmit}
                  style={{ backgroundColor: "var(--kova-blue)" }}
className={`kova-send-button mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-white shadow-sm transition duration-150 hover:opacity-90 active:scale-90 active:opacity-70 lg:h-9 lg:w-9 ${sendFlash ? "scale-90 opacity-80" : ""}`}
                  aria-label="Send"
                >
                  <ArrowUp
                    className={`w-5 h-5 transition-transform duration-300 ${sendFlash ? "-translate-y-1.5 opacity-0" : ""}`}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="kova-send-button mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground lg:h-9 lg:w-9"
                  aria-label="Send"
                  title="Type a message to send"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex min-h-9 items-center justify-between gap-2 px-2 pb-2">
            <div className="relative flex items-center gap-1.5" ref={toolsWrapRef}>
              <button
                type="button"
                onClick={() => setToolsOpen((value) => !value)}
className={`kova-tool-button inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition ${
                  toolsOpen
                    ? "border-foreground/20 bg-accent text-foreground"
                    : "border-border/70 bg-background/55 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                aria-label="Open tools"
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Tools</span>
              </button>
              {toolsOpen && !isMobileLayout && (
                <div
                  role="menu"
                  className="kova-glass absolute bottom-10 left-0 z-50 w-64 rounded-xl p-1.5 animate-in fade-in slide-in-from-bottom-1"
                >
                  {toolActions.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.label}
                        role="menuitem"
                        type="button"
                        onClick={() => applyTool(tool.id, tool.prompt)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span>{tool.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="kova-composer-shortcuts flex min-w-0 flex-wrap items-center gap-1.5">
              {shortcutActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => applyShortcut(action.prompt)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/55 px-2.5 text-[12.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`${action.label} shortcut`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{action.label}</span>
                  </button>
                );
              })}
            </div>
            {mode && onModeChange && (
              <div className="flex items-center lg:hidden">
                <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
              </div>
            )}
          </div>
          {isMobileLayout && (
            <MobileBottomSheet
              open={toolsOpen}
              onOpenChange={setToolsOpen}
              title="Tools"
              ariaLabel="Choose a tool"
            >
              <div className="flex flex-col gap-1 p-1">
                {toolActions.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.label}
                      type="button"
                      onClick={() => applyTool(tool.id, tool.prompt)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-4 text-left text-base hover:bg-accent active:bg-accent"
                    >
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <span>{tool.label}</span>
                    </button>
                  );
                })}
              </div>
            </MobileBottomSheet>
          )}
        </div>
      </div>
    </div>
  );
}
