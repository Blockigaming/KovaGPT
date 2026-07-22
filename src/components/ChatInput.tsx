import {
  ArrowUp,
  Square,
  Plus,
  X,
  Mic,
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

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

import { useEffect, useRef, useState } from "react";
import { tryUseUpload, DAILY_UPLOAD_LIMIT, getUsage } from "@/lib/limits";
import { toast } from "sonner";
import { ResponsiveModelSelector as ModelSelector } from "@/components/ResponsiveModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

export type PendingAttachment = {
  kind: "image";
  dataUrl: string;
  name: string;
  size?: number;
  status?: "selected" | "uploading" | "complete" | "failed";
  error?: string;
};
export type ComposerToolId =
  | "web_search"
  | "deep_research"
  | "image"
  | "study"
  | "data_analysis"
  | "file_analysis";

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
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef<string>("");
  const submittingRef = useRef(false);
  const composingRef = useRef(false);
  const [uploadAnnouncement, setUploadAnnouncement] = useState("");

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

  return (
    <div
      className="w-full px-3 sm:px-6 lg:px-8 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 transition-[padding] duration-150"
      style={isMobileLayout && kbOffset > 0 ? { paddingBottom: `${kbOffset + 8}px` } : undefined}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl">
        <div
          style={
            sendFlash
              ? ({
                  boxShadow: `0 0 0 2px ${actionColor}33`,
                  borderColor: `${actionColor}99`,
                } as React.CSSProperties)
              : undefined
          }
          className={`rounded-[28px] border bg-card shadow-[0_12px_32px_-20px_rgba(0,0,0,0.45),0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-200 focus-within:border-muted-foreground/50 ${
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
                  className="relative min-h-16 w-20 overflow-hidden rounded-xl border border-border bg-muted/30"
                >
                  {a.dataUrl ? (
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
          <div className="flex min-h-[56px] items-center">
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
                className={`w-11 h-11 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 active:scale-95 transition outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${plusOpen && !isMobileLayout ? "rotate-45 text-foreground" : ""}`}
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
                  className="absolute bottom-11 left-0 z-50 min-w-[200px] rounded-2xl border border-border bg-popover shadow-xl p-1.5 animate-in fade-in slide-in-from-bottom-1"
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
              className="flex-1 resize-none bg-transparent px-2 py-[0.65rem] outline-none border-0 focus:ring-0 focus:outline-none text-foreground placeholder:text-muted-foreground max-h-[200px] leading-relaxed text-base lg:text-sm"
            />
            <div className="flex items-center gap-1.5 pr-1.5">
              {mode && onModeChange && (
                <div className="hidden lg:flex items-center">
                  <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
                </div>
              )}
              {!isStreaming && !(value.trim() || attachments.length > 0) && (
                <button
                  type="button"
                  onClick={async () => {
                    // Toggle off if already listening.
                    if (listening && recRef.current) {
                      try {
                        recRef.current.stop();
                      } catch {
                        /* ignore */
                      }
                      setListening(false);
                      return;
                    }
                    const w = window as unknown as {
                      SpeechRecognition?: new () => SpeechRecognitionLike;
                      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
                    };
                    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
                    if (!Ctor) {
                      toast.error(
                        "Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.",
                      );
                      return;
                    }
                    // Proactively check permission (skip on Safari which lacks Permissions API for microphone).
                    try {
                      const permsApi = (
                        navigator as Navigator & {
                          permissions?: {
                            query: (d: { name: PermissionName }) => Promise<{ state: string }>;
                          };
                        }
                      ).permissions;
                      if (permsApi?.query) {
                        const status = await permsApi.query({
                          name: "microphone" as PermissionName,
                        });
                        if (status.state === "denied") {
                          toast.error("Microphone is blocked. Enable it in your browser settings.");
                          return;
                        }
                      }
                    } catch {
                      /* Safari: proceed anyway */
                    }

                    const rec = new Ctor();
                    rec.lang = navigator.language || "en-US";
                    rec.interimResults = true;
                    rec.continuous = true;
                    dictationBaseRef.current = value ? value.replace(/\s*$/, "") + " " : "";
                    rec.onresult = (e) => {
                      let finalText = "";
                      let interimText = "";
                      for (let i = e.resultIndex; i < e.results.length; i++) {
                        const res = e.results[i] as ArrayLike<{ transcript: string }> & {
                          isFinal?: boolean;
                        };
                        const chunk = res[0]?.transcript ?? "";
                        if (res.isFinal) finalText += chunk;
                        else interimText += chunk;
                      }
                      if (finalText) {
                        dictationBaseRef.current = (dictationBaseRef.current + finalText).replace(
                          /\s+/g,
                          " ",
                        );
                        if (!/\s$/.test(dictationBaseRef.current)) dictationBaseRef.current += " ";
                      }
                      onChange((dictationBaseRef.current + interimText).trimStart());
                    };
                    rec.onerror = (e) => {
                      const err = e?.error ?? "";
                      if (err === "not-allowed" || err === "service-not-allowed") {
                        toast.error("Microphone permission denied.");
                      } else if (err === "no-speech") {
                        // Silent fail — just stop.
                      } else if (err === "audio-capture") {
                        toast.error("No microphone found.");
                      } else if (err && err !== "aborted") {
                        toast.error("Voice input failed. Try again.");
                      }
                      setListening(false);
                    };
                    rec.onend = () => {
                      setListening(false);
                      recRef.current = null;
                    };
                    try {
                      rec.start();
                      recRef.current = rec;
                      setListening(true);
                    } catch {
                      toast.error("Couldn't start voice input. Try again.");
                    }
                  }}
                  className={`w-11 h-11 lg:w-9 lg:h-9 rounded-full flex items-center justify-center transition ${
                    listening
                      ? "bg-red-500/90 text-white animate-pulse"
                      : "bg-accent/60 text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  aria-label={listening ? "Stop voice input" : "Voice input"}
                  aria-pressed={listening}
                  title={listening ? "Stop dictation" : "Voice input"}
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  style={{ backgroundColor: actionColor }}
                  className="w-11 h-11 lg:w-9 lg:h-9 rounded-full text-white flex items-center justify-center hover:opacity-80 transition"
                  aria-label="Stop"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : value.trim() || attachments.length > 0 ? (
                <button
                  type="button"
                  onClick={triggerSubmit}
                  style={{ backgroundColor: actionColor }}
                  className={`w-11 h-11 lg:w-9 lg:h-9 rounded-full text-white flex items-center justify-center shadow-sm hover:opacity-90 transition duration-150 active:scale-90 active:opacity-70 ${sendFlash ? "scale-90 opacity-80" : ""}`}
                  aria-label="Send"
                >
                  <ArrowUp
                    className={`w-5 h-5 transition-transform duration-300 ${sendFlash ? "-translate-y-1.5 opacity-0" : ""}`}
                  />
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="relative flex items-center gap-1.5" ref={toolsWrapRef}>
              <button
                type="button"
                onClick={() => setToolsOpen((value) => !value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition ${
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
                  className="absolute bottom-10 left-0 z-50 w-64 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-1"
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
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {shortcutActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => applyShortcut(action.prompt)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-background/55 px-2.5 text-[12.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
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
