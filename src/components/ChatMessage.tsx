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
  GitBranch,
  Globe,
  Mail,
  FileText,
  ThumbsUp,
  ThumbsDown,
  History,
  TextSelect,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { useLayout } from "@/hooks/use-mobile";
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
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
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
const MessageVersionHistoryDialog = lazy(() =>
  import("./MessageVersionHistoryDialog").then(({ MessageVersionHistoryDialog }) => ({
    default: MessageVersionHistoryDialog,
  })),
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
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
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
};

const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
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
  userKey,
  principalResolved,
  chatId,
  temporary = false,
  onReplaceContent,
}: {
  message: Message;
  streaming?: boolean;
  onFollowUp?: (prompt: string) => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
  onUpdatePendingConfirm?: (messageId: string, next: PendingConfirm) => void;
  userKey: string | null;
  principalResolved: boolean;
  /** Enables durable, per-message edit history in Canvas when signed in. */
  chatId?: string | null;
  /** Temporary chats never persist edits or versions. */
  temporary?: boolean;
  /** Applies an accepted selection edit / restored version to this message. */
  onReplaceContent?: (messageId: string, nextContent: string) => void;
}) {
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const lifecycleGenerationRef = useRef(0);
  useEffect(() => {
    lifecycleGenerationRef.current += 1;
  }, [principal]);
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const feedbackKey = message.id ? `kova-message-feedback:${message.id}` : null;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(() => {
    if (!feedbackKey) return null;
    const stored = safeBrowserStorage("localStorage")?.getItem(feedbackKey);
    return stored === "up" || stored === "down" ? stored : null;
  });
  const persistFeedback = (next: "up" | "down" | null) => {
    setFeedback(next);
    if (!feedbackKey) return;
    const storage = safeBrowserStorage("localStorage");
    if (next) storage?.setItem(feedbackKey, next);
    else storage?.removeItem(feedbackKey);
    toast.success("Rating saved on this device");
  };
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
  const [selectionTarget, setSelectionTarget] = useState<{
    source: string;
    start: number;
    end: number;
  } | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastSelectionRef = useRef<string>("");
  const { isSignedIn } = useUser();

  // Remember the rendered selection while the user still has it: opening a menu
  // clears the DOM selection in most browsers.
  const rememberSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const container = bodyRef.current;
    if (container && selection.anchorNode && !container.contains(selection.anchorNode)) return;
    lastSelectionRef.current = selection.toString();
  }, []);

  const openSelectionEdit = useCallback(async () => {
    const { locateSelection } = await import("@/lib/selection-edit.mjs");
    const picked =
      (typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "") ||
      lastSelectionRef.current;
    try {
      const range = locateSelection(message.content, picked);
      setSelectionTarget({ source: message.content, start: range.start, end: range.end });
      setSelectionOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Select some text in the response first.",
      );
    }
  }, [message.content]);

  const saveFn = useServerFn(saveToLibrary);

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      lifecycleGenerationRef.current += 1;
      setSaving(false);
      setSaved(false);
      setCopied(false);
      setEditorOpen(false);
      setMobileSheetOpen(false);
      cancelLongPress();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [cancelLongPress, principal, principalResolved, userKey]);

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
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveItem = async () => {
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
        content_text: message.content.slice(0, 100_000),
      };
      if (isSignedIn) await saveFn({ data: payload });
      else {
        const { saveGuestItem } = await import("@/lib/guest-library");
        if (!isCurrent()) return;
        saveGuestItem(payload);
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
      className="kova-message group w-full px-3 py-3 text-[15px] leading-7 sm:px-5 lg:px-10 lg:py-4 lg:text-base"
      aria-label={isUser ? "Your message" : "KovaGPT response"}
    >
      {isUser ? (
        <div className="mx-auto flex max-w-[48rem] justify-end">
          <div className="flex min-w-0 max-w-[85%] flex-col items-end sm:max-w-[75%]">
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
              <div className="kova-user-message prose-chat whitespace-pre-wrap break-words rounded-[1.75rem] bg-[var(--user-bubble)] px-4 py-2.5 text-foreground">
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
        <div className="kova-assistant-message mx-auto flex max-w-[48rem] items-start justify-start">
          <div
            ref={bodyRef}
            className="flex-1 min-w-0 min-h-8 [[data-sidebar=closed]_&]:min-h-9 flex flex-col justify-center select-text"
            onMouseUp={rememberSelection}
            onKeyUp={rememberSelection}
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onTouchCancel={cancelLongPress}
            onContextMenu={(event) => {
              if (isMobile) {
                event.preventDefault();
                setMobileSheetOpen(true);
              }
            }}
          >
            {message.activities && message.activities.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {message.activities.map((activity, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <Check className="w-3 h-3 text-primary" />
                    {activity.label}
                  </span>
                ))}
              </div>
            )}
            <div className="prose-chat">
              {message.pendingConfirms?.map((confirm) => (
                <ToolConfirmCard
                  key={confirm.actionId}
                  confirm={confirm}
                  onUpdate={(next) => onUpdatePendingConfirm?.(message.id, next)}
                />
              ))}
              {message.pendingImage && !message.content ? (
                <div className="relative w-full max-w-sm aspect-square rounded-2xl border border-border overflow-hidden bg-gradient-to-br from-accent/60 via-muted to-accent/60">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-70"
                    style={{
                      backgroundImage:
                        "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 1.8s linear infinite",
                    }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div className="relative">
                      <ImageIcon className="w-10 h-10 text-foreground/70" />
                      <Loader2 className="w-5 h-5 absolute -bottom-1 -right-1 animate-spin text-primary" />
                    </div>
                    <div
                      className="text-sm font-medium bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, var(--color-muted-foreground) 0%, var(--color-foreground) 50%, var(--color-muted-foreground) 100%)",
                        backgroundSize: "200% 100%",
                        animation: "shimmer 1.8s linear infinite",
                      }}
                    >
                      Creating image
                    </div>
                  </div>
                </div>
              ) : streaming && !message.content ? (
                <StreamingStatus activities={message.activities} />
              ) : (
                (() => {
                  const cleaned = cleanAssistantText(message.content);
                  const parts = extractCharts(cleaned);
                  const hasChart = parts.some((part) => part.kind === "chart");
                  const markdown = hasChart ? (
                    <div className="space-y-2">
                      {parts.map((part, index) =>
                        part.kind === "chart" ? (
                          <Suspense key={index} fallback={null}>
                            <ChatChart spec={part.spec} />
                          </Suspense>
                        ) : part.value.trim() ? (
                          <MarkdownContent key={index}>{part.value}</MarkdownContent>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <MarkdownContent>{cleaned}</MarkdownContent>
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
          </div>
        </div>
      )}
      <div className="mx-auto max-w-[48rem]">
        <div className={isUser ? "flex justify-end" : "flex justify-start"}>
          {!streaming && !isUser && message.content && (
            <div className="kova-message-actions mt-1 max-w-full overflow-x-auto">
              <button
                onClick={copy}
                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent transition-colors duration-100"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy"}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[color:var(--kova-blue)] animate-check-pop" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>

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

              {artifactKind && (
                <button
                  type="button"
                  onClick={() => {
                    setEditorMode(artifactKind === "code" ? "preview" : "edit");
                    setEditorOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent/80"
                  aria-label={
                    artifactKind === "code" ? "Open code full screen" : "Open writing full screen"
                  }
                  title={
                    artifactKind === "code" ? "Open code full screen" : "Open writing full screen"
                  }
                >
                  {artifactKind === "code" ? (
                    <Code2 className="h-3.5 w-3.5" />
                  ) : (
                    <FileEdit className="h-3.5 w-3.5" />
                  )}
                  {artifactKind === "code" ? "Open code" : "Open writing"}
                </button>
              )}

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
                  <DropdownMenuItem
                    onClick={() => {
                      const sourceActivity = message.activities?.find((activity) =>
                        /search|source|web/i.test(activity.tool + activity.label),
                      );
                      if (sourceActivity) toast.message(sourceActivity.label);
                      else toast.message("No linked sources for this response");
                    }}
                  >
                    <Globe className="mr-2 h-4 w-4" /> View sources
                  </DropdownMenuItem>
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
                    onSelect={() => setVersionsOpen(true)}
                    disabled={!chatId || !message.id}
                  >
                    <History className="mr-2 h-4 w-4" /> Version history
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onRetry} disabled={!onRetry}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
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
      {artifactKind && (
        <Suspense fallback={null}>
          <ArtifactEditor
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            initialContent={editorContent}
            kind={artifactKind}
            onImprove={onFollowUp}
            initialMode={editorMode}
            chatId={chatId ?? null}
            messageId={message.id ?? null}
          />
        </Suspense>
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
                  const query = encodeURIComponent(message.content.slice(0, 300));
                  window.open(
                    `https://www.google.com/search?q=${query}`,
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
