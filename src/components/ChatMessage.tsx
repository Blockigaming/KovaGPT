import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  ImageIcon,
  Loader2,
  Bookmark,
  FileEdit,
  Code2,
  Eye,
  MoreHorizontal,
  Share2,
  Pencil,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  GitBranch,
  Globe,
  Mail,
  FileText,
  Volume2,
  CircleStop,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { useLayout } from "@/hooks/use-mobile";
import type { Message } from "@/lib/chat-store";
import { extractCharts } from "./chat-chart-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser } from "@/components/auth/ClerkSafe";
import { detectArtifactKind, extractCodeBlocks } from "./artifact-utils";
import { ToolConfirmCard } from "./ToolConfirmCard";
import type { PendingConfirm } from "@/lib/chat-store";
import { InfoChip } from "./InfoChip";
import { detectInfoChip } from "./info-chip-utils";
import { canReadAloud, speechText } from "@/lib/browser-voice";
import { submitResponseFeedback } from "@/lib/feedback.functions";
import { MessageImage } from "./MessageImage";
import { extractEmailFromMessage, openEmailCompose } from "./message-action-utils";

const ChatChart = lazy(() =>
  import("./ChatChart").then((module) => ({ default: module.ChatChart })),
);
const ArtifactEditor = lazy(() =>
  import("./ArtifactEditor").then((module) => ({ default: module.ArtifactEditor })),
);

function MarkdownCode({ className, children }: React.ComponentProps<"code">) {
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
  const text = String(children).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  if (!language && !text.includes("\n")) return <code className={className}>{children}</code>;
  return (
    <div className="kova-code-block group/code" data-language={language ?? "text"}>
      <div className="kova-code-toolbar">
        <span>{language ?? "text"}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            } catch {
              toast.error("Code could not be copied. Check clipboard access and try again.");
            }
          }}
          aria-label={copied ? "Code copied" : "Copy code"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${language ?? "Text"} code block`}>
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

const markdownComponents = {
  pre: ({ children }: React.ComponentProps<"pre">) => <>{children}</>,
  code: MarkdownCode,
  table: ({ children }: React.ComponentProps<"table">) => (
    <div className="kova-table-scroll" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  a: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ),
  img: (props: React.ComponentProps<"img">) => <MessageImage {...props} />,
};

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
});

// Preserve the model's markdown exactly enough for source links, citation
// markers, lists, and typography to survive rendering. ReactMarkdown handles
// escaping; this normalization only makes streamed Windows line endings
// deterministic.
function cleanAssistantText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

// Detect email-like assistant output and extract subject + body so the
// "Send email" button can prefill Gmail / Outlook compose windows. Handles
// three shapes: an explicit "Subject: ..." line, a fenced block labelled
// email, or a message that opens with a greeting like Hi/Hello/Dear.
// Short status label shown while the assistant is streaming but has no text yet.
// Derives from the latest running/last activity tool, so users see
// "Searching", "Reading Files", "Interacting with Gmail", etc.
function StreamingStatus({ activities }: { activities?: import("@/lib/chat-store").Activity[] }) {
  const last = activities && activities.length > 0 ? activities[activities.length - 1] : null;
  const tool = (last?.tool ?? "").toLowerCase();
  let label = "Thinking";
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
    else label = last?.label ?? "Working";
  }
  return (
    <div className="kova-thinking-indicator flex items-center gap-2 py-1" aria-live="polite">
      <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />
      <span key={label} className="text-sm font-medium text-muted-foreground">
        {label}…
      </span>
    </div>
  );
}

function ChatMessageInner({
  message,
  streaming,
  onFollowUp,
  onRetry,
  onBranch,
  onEdit,
  onUpdatePendingConfirm,
}: {
  message: Message;
  streaming?: boolean;
  onFollowUp?: (prompt: string) => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
  onUpdatePendingConfirm?: (messageId: string, next: PendingConfirm) => void;
}) {
  const feedbackKey = `kova-feedback:${message.id}`;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(feedbackKey);
      if (v === "up" || v === "down") setFeedback(v);
    } catch {
      /* ignore */
    }
  }, [feedbackKey]);
  const persistFeedback = async (next: "up" | "down" | null) => {
    const previous = feedback;
    setFeedback(next);
    try {
      if (next) localStorage.setItem(feedbackKey, next);
      else localStorage.removeItem(feedbackKey);
    } catch {
      /* ignore */
    }
    if (!isSignedIn) return;
    try {
      await feedbackFn({
        data: {
          messageId: message.id,
          rating: next,
          contextExcerpt: next ? message.content.slice(0, 2_000) : undefined,
        },
      });
    } catch {
      setFeedback(previous);
      toast.error("Feedback could not be saved. Try again.");
    }
  };
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const { isMobile } = useLayout();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);
  const startLongPress = useCallback(() => {
    if (!isMobile) return;
    pressFired.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true;
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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [readAloudSupported, setReadAloudSupported] = useState(false);
  const { isSignedIn } = useUser();
  const feedbackFn = useServerFn(submitResponseFeedback);

  const saveFn = useServerFn(saveToLibrary);

  useEffect(() => {
    setReadAloudSupported(canReadAloud());
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  const toggleReadAloud = useCallback(() => {
    if (!canReadAloud()) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText(message.content));
    utterance.lang = document.documentElement.lang || navigator.language || "en-US";
    utterance.rate = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [isSpeaking, message.content]);

  const artifactKind = useMemo(
    () => (isUser ? null : detectArtifactKind(message.content || "")),
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

  const email = useMemo(
    () => (isUser ? null : extractEmailFromMessage(message.content || "")),
    [isUser, message.content],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Response could not be copied. Check clipboard access and try again.");
    }
  };

  const saveItem = async () => {
    // Guests can save to a local-only library (kept in localStorage). The
    // ClerkSafe sign-in prompt is no longer shown here.

    // Duplicate-safe: stable per-message id stored in localStorage avoids re-saves.
    const dedupKey = "kovagpt:savedMessageIds";
    let savedIds: string[];
    try {
      savedIds = JSON.parse(localStorage.getItem(dedupKey) || "[]");
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
      const codeRatio = (content.match(/```/g)?.length ?? 0) >= 2;
      let title: string;
      if (codeRatio) {
        title = "Saved code response";
      } else if (content.length > 1200) {
        title = "Saved writing draft";
      } else {
        const firstSentence = content.split(/(?<=[.!?])\s+/)[0] ?? content;
        const words = firstSentence.replace(/\s+/g, " ").split(" ").slice(0, 10).join(" ");
        title = words ? words.slice(0, 120) : "Saved chat response";
      }
      const payload = {
        title,
        item_type: (codeRatio ? "code" : "chat_artifact") as "code" | "chat_artifact",
        source: "chat" as const,
        content_text: message.content.slice(0, 100_000),
      };
      if (isSignedIn) {
        await saveFn({ data: payload });
      } else {
        const { saveGuestItem } = await import("@/lib/guest-library");
        saveGuestItem(payload);
      }

      if (message.id) {
        try {
          savedIds.push(message.id);
          localStorage.setItem(dedupKey, JSON.stringify(savedIds.slice(-500)));
        } catch {
          /* ignore */
        }
      }
      setSaved(true);
      toast.success("Saved to Library");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      className="kova-message group w-full animate-fade-in px-3 py-3 text-[15px] leading-[1.6] sm:px-5 lg:px-10 lg:py-4 lg:text-[16px] lg:leading-[1.65]"
      aria-label={isUser ? "Your message" : "KovaGPT response"}
    >
      {isUser ? (
        <div className="mx-auto flex max-w-[48rem] justify-end">
          <div className="flex min-w-0 max-w-[88%] flex-col items-end sm:max-w-[78%] lg:max-w-[76%]">
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 justify-end">
                {message.attachments
                  .filter((a): a is Extract<typeof a, { kind: "image" }> => a.kind === "image")
                  .map((a, i) => (
                    <MessageImage
                      key={i}
                      src={a.dataUrl}
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
                  .map((attachment) => (
                    <span
                      key={
                        attachment.kind === "library_file"
                          ? attachment.libraryItemId
                          : `${attachment.name}:${attachment.size ?? 0}`
                      }
                      className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/55 px-3 py-2 text-xs text-foreground"
                      title={attachment.name}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="max-w-48 truncate">{attachment.name}</span>
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                        {attachment.kind === "library_file" ? "Library" : "Attached"}
                      </span>
                    </span>
                  ))}
              </div>
            )}
            {message.content && (
              <div className="kova-user-message prose-chat whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-[var(--user-bubble)] px-3.5 py-2.5 text-foreground">
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
        <div className="kova-assistant-message mx-auto flex max-w-[48rem] animate-fade-up items-start justify-start">
          <div
            className="flex-1 min-w-0 min-h-8 [[data-sidebar=closed]_&]:min-h-9 flex flex-col justify-center select-text"
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onTouchCancel={cancelLongPress}
            onContextMenu={(e) => {
              if (isMobile) {
                e.preventDefault();
                setMobileSheetOpen(true);
              }
            }}
          >
            {message.activities && message.activities.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {message.activities.map((a) => (
                  <span
                    key={`${a.tool}:${a.label}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <Check className="w-3 h-3 text-primary" />
                    {a.label}
                  </span>
                ))}
              </div>
            )}
            <div className="prose-chat">
              {message.pendingConfirms?.map((pc) => (
                <ToolConfirmCard
                  key={pc.actionId}
                  confirm={pc}
                  onUpdate={(next) => onUpdatePendingConfirm?.(message.id, next)}
                />
              ))}
              {message.pendingImage && !message.content ? (
                <div className="kova-image-skeleton relative aspect-square w-full max-w-sm overflow-hidden rounded-xl border border-border bg-muted">
                  <div aria-hidden className="kova-skeleton-shimmer absolute inset-0 opacity-70" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div className="relative">
                      <ImageIcon className="w-10 h-10 text-foreground/70" />
                      <Loader2 className="w-5 h-5 absolute -bottom-1 -right-1 animate-spin text-primary" />
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">Creating image</div>
                  </div>
                </div>
              ) : streaming && !message.content ? (
                <StreamingStatus activities={message.activities} />
              ) : (
                (() => {
                  const cleaned = cleanAssistantText(message.content);
                  const parts = extractCharts(cleaned);
                  const hasChart = parts.some((p) => p.kind === "chart");
                  const md = hasChart ? (
                    <div className="space-y-2">
                      {parts.map((p, i) =>
                        p.kind === "chart" ? (
                          <Suspense
                            key={i}
                            fallback={
                              <div className="my-4 h-48 animate-pulse rounded-2xl bg-muted" />
                            }
                          >
                            <ChatChart spec={p.spec} />
                          </Suspense>
                        ) : p.value.trim() ? (
                          <MarkdownContent key={i} content={p.value} />
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <MarkdownContent content={cleaned} />
                  );
                  if (artifactKind || streaming) return md;
                  const chip = detectInfoChip(cleaned);
                  if (chip)
                    return (
                      <InfoChip kind={chip} rawText={cleaned}>
                        {md}
                      </InfoChip>
                    );
                  return md;
                })()
              )}
              {streaming && message.content && <span className="cursor-blink" aria-hidden="true" />}
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-[48rem]">
        <div className={isUser ? "flex justify-end" : "flex justify-start"}>
          {!streaming && !isUser && message.content && (
            <div className="kova-message-actions mt-1 max-w-full overflow-x-auto transition-opacity lg:opacity-60 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
              {/* Visible: Copy, Thumbs up, Thumbs down, Share */}
              <button
                onClick={copy}
                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy"}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[color:var(--kova-blue)] animate-check-pop" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              {isSignedIn ? (
                <button
                  onClick={() => {
                    const next = feedback === "up" ? null : "up";
                    void persistFeedback(next);
                    if (next) toast.success("Thanks for the feedback");
                  }}
                  className={`inline-flex items-center justify-center p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95 ${
                    feedback === "up"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Good response"
                  aria-label="Good response"
                  aria-pressed={feedback === "up"}
                >
                  <ThumbsUp className={`w-4 h-4 ${feedback === "up" ? "fill-current" : ""}`} />
                </button>
              ) : null}
              {isSignedIn ? (
                <button
                  onClick={() => {
                    const next = feedback === "down" ? null : "down";
                    void persistFeedback(next);
                    if (next) toast.success("Thanks, we'll improve");
                  }}
                  className={`inline-flex items-center justify-center p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95 ${
                    feedback === "down"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Bad response"
                  aria-label="Bad response"
                  aria-pressed={feedback === "down"}
                >
                  <ThumbsDown className={`w-4 h-4 ${feedback === "down" ? "fill-current" : ""}`} />
                </button>
              ) : null}
              <button
                onClick={async () => {
                  const text = message.content;
                  if (typeof navigator !== "undefined" && navigator.share) {
                    try {
                      await navigator.share({ text, title: "KovaGPT response" });
                      return;
                    } catch {
                      /* user cancelled */
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(text);
                    toast.success("Response copied to clipboard");
                  } catch {
                    toast.error("Couldn't share");
                  }
                }}
                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95"
                title="Share"
                aria-label="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>

              {readAloudSupported && (
                <button
                  type="button"
                  onClick={toggleReadAloud}
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-all hover:scale-[1.08] hover:bg-accent hover:text-foreground active:scale-95"
                  title={isSpeaking ? "Stop reading" : "Read aloud"}
                  aria-label={isSpeaking ? "Stop reading response" : "Read response aloud"}
                  aria-pressed={isSpeaking}
                >
                  {isSpeaking ? (
                    <CircleStop className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              )}

              {email && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 px-2.5 py-1.5 rounded-full transition-all hover:scale-[1.03] active:scale-95"
                      title="Send this email"
                      aria-label="Send this email"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Send email</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      Body copied to clipboard. Add recipients in the compose window.
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

              {/* Everything else lives behind the 3-dot menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {onEdit ? (
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="w-4 h-4 mr-2" /> Edit
                    </DropdownMenuItem>
                  ) : null}
                  {onRetry ? (
                    <DropdownMenuItem onClick={onRetry}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Retry
                    </DropdownMenuItem>
                  ) : null}
                  {onBranch ? (
                    <DropdownMenuItem onClick={onBranch}>
                      <GitBranch className="w-4 h-4 mr-2" /> Branch in new chat
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      const q = encodeURIComponent(message.content.slice(0, 300));
                      window.open(
                        `https://www.google.com/search?q=${q}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                  >
                    <Globe className="w-4 h-4 mr-2" /> Search the web
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={saveItem} disabled={saving}>
                    <Bookmark className={`w-4 h-4 mr-2 ${saved ? "fill-current" : ""}`} />
                    {saved ? "Saved" : saving ? "Saving…" : "Save to Library"}
                  </DropdownMenuItem>
                  {artifactKind && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditorMode("edit");
                        setEditorOpen(true);
                      }}
                    >
                      {artifactKind === "writing" ? (
                        <FileEdit className="w-4 h-4 mr-2" />
                      ) : (
                        <Code2 className="w-4 h-4 mr-2" />
                      )}
                      {artifactKind === "website"
                        ? "Open website full screen"
                        : artifactKind === "code"
                          ? "Open code full screen"
                          : "Open writing full screen"}
                    </DropdownMenuItem>
                  )}
                  {artifactKind === "website" && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditorMode("preview");
                        setEditorOpen(true);
                      }}
                    >
                      <Eye className="w-4 h-4 mr-2" /> Preview website
                    </DropdownMenuItem>
                  )}
                  {onFollowUp && (
                    <>
                      <DropdownMenuSeparator />
                      {[
                        { label: "Continue", prompt: "Continue from where you left off." },
                        {
                          label: "Shorter",
                          prompt:
                            "Rewrite your last response to be shorter, keeping the key points.",
                        },
                        {
                          label: "Longer",
                          prompt: "Expand your last response with more detail and examples.",
                        },
                        {
                          label: "Improve",
                          prompt: "Improve the wording and clarity of your last response.",
                        },
                      ].map((a) => (
                        <DropdownMenuItem key={a.label} onClick={() => onFollowUp(a.prompt)}>
                          {a.label}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
      {artifactKind && (
        <Suspense fallback={null}>
          <ArtifactEditor
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            initialContent={editorContent}
            kind={artifactKind}
            onImprove={onFollowUp}
            initialMode={editorMode}
          />
        </Suspense>
      )}
      {!isUser && message.content && (
        <MobileBottomSheet
          open={mobileSheetOpen}
          onOpenChange={setMobileSheetOpen}
          title="Message actions"
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
              ...(isSignedIn
                ? [
                    {
                      label: feedback === "up" ? "Remove good rating" : "Good response",
                      icon: ThumbsUp,
                      onClick: () => {
                        void persistFeedback(feedback === "up" ? null : "up");
                        setMobileSheetOpen(false);
                      },
                    },
                    {
                      label: feedback === "down" ? "Remove bad rating" : "Bad response",
                      icon: ThumbsDown,
                      onClick: () => {
                        void persistFeedback(feedback === "down" ? null : "down");
                        setMobileSheetOpen(false);
                      },
                    },
                  ]
                : []),
              {
                label: "Share",
                icon: Share2,
                onClick: async () => {
                  setMobileSheetOpen(false);
                  const text = message.content;
                  if (typeof navigator !== "undefined" && navigator.share) {
                    try {
                      await navigator.share({ text, title: "KovaGPT response" });
                      return;
                    } catch {
                      /* cancel */
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(text);
                    toast.success("Response copied");
                  } catch {
                    toast.error("Couldn't share");
                  }
                },
              },
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
              ...(onRetry
                ? [
                    {
                      label: "Retry",
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
                  const q = encodeURIComponent(message.content.slice(0, 300));
                  window.open(
                    `https://www.google.com/search?q=${q}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                  setMobileSheetOpen(false);
                },
              },
              {
                label: saved ? "Saved" : "Save to Library",
                icon: Bookmark,
                onClick: () => {
                  saveItem();
                  setMobileSheetOpen(false);
                },
              },
            ].map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="flex items-center gap-3 px-4 py-3 text-left text-[15px] rounded-lg hover:bg-accent active:bg-accent/70 transition"
              >
                <a.icon className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="flex-1">{a.label}</span>
              </button>
            ))}
          </div>
        </MobileBottomSheet>
      )}
    </article>
  );
}

export const ChatMessage = memo(ChatMessageInner);
