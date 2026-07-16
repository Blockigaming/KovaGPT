import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ImageIcon, Loader2, Bookmark, FileEdit, Code2, Eye, MoreHorizontal, Share2, Pencil, RefreshCw, ThumbsUp, ThumbsDown, GitBranch, Globe, Mail } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";
import { ChatChart, extractCharts } from "./ChatChart";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser } from "@/components/auth/ClerkSafe";
import { ArtifactEditor, detectArtifactKind, extractCodeBlocks } from "./ArtifactEditor";
import { ToolConfirmCard } from "./ToolConfirmCard";
import type { PendingConfirm } from "@/lib/chat-store";
import { LongResponseCard, shouldWrapAsDocument } from "./LongResponseCard";
import { InfoChip, detectInfoChip } from "./InfoChip";

// Strip numbered citation markers like [1], [2], [3] that web-search-augmented
// answers sometimes still inject, and normalize en/em dashes to a hyphen
// so the assistant never shows them in the UI.
function cleanAssistantText(text: string): string {
  return text
    .replace(/\s?\[\d+\](?:\[\d+\])*/g, "")
    .replace(/\s?\[\d+(?:\s*,\s*\d+)+\]/g, "")
    .replace(/[\u2013\u2014]/g, "-");
}

// Detect email-like assistant output and extract subject + body so the
// "Send email" button can prefill Gmail / Outlook compose windows. Handles
// three shapes: an explicit "Subject: ..." line, a fenced block labelled
// email, or a message that opens with a greeting like Hi/Hello/Dear.
export function extractEmailFromMessage(
  raw: string,
): { subject: string; body: string } | null {
  if (!raw) return null;
  const text = raw.replace(/\r\n/g, "\n").trim();

  // 1) "Subject: ..." on its own line (case-insensitive).
  const subjectMatch = text.match(/^\s*subject\s*:\s*(.+)$/im);
  if (subjectMatch) {
    const subject = subjectMatch[1].trim().replace(/^["']|["']$/g, "");
    const body = text
      .replace(subjectMatch[0], "")
      .replace(/^\s*to\s*:.*$/im, "")
      .replace(/^\s*from\s*:.*$/im, "")
      .replace(/^\s*cc\s*:.*$/im, "")
      .replace(/^\s*bcc\s*:.*$/im, "")
      .replace(/^```(?:email|markdown|text)?\n?/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    if (body.length > 10) return { subject, body };
  }

  // 2) Fenced ```email block.
  const fenced = text.match(/```(?:email|eml)?\s*\n([\s\S]+?)```/i);
  if (fenced) {
    const inner = fenced[1].trim();
    const nested = extractEmailFromMessage(inner);
    if (nested) return nested;
  }

  // 3) Greeting heuristic - starts with Hi/Hello/Dear/Hey <Name>, and has
  // enough body + a signoff to feel like a real email draft.
  const greeting = text.match(/^(hi|hello|dear|hey|good\s+(morning|afternoon|evening))\b[^\n]{0,60},?\s*\n/i);
  const signoff = /\n\s*(best|thanks|thank you|regards|sincerely|cheers|kind regards|warmly|talk soon)[,\s]/i.test(text);
  if (greeting && signoff && text.length > 80) {
    return { subject: "", body: text };
  }

  return null;
}

// Open a compose window in Gmail or Outlook prefilled with subject/body, and
// copy the body to the clipboard as a fallback so the user can paste manually.
export async function openEmailCompose(
  provider: "gmail" | "outlook",
  subject: string,
  body: string,
) {
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    /* clipboard may be blocked; the compose URL still carries the body */
  }
  const su = encodeURIComponent(subject);
  const bo = encodeURIComponent(body);
  const url =
    provider === "gmail"
      ? `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${su}&body=${bo}`
      : `https://outlook.office.com/mail/deeplink/compose?subject=${su}&body=${bo}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// Rotating idle statuses cycled while the assistant is streaming with no
// tool activity, so users see progression rather than a static "Thinking".
const IDLE_STATUSES = [
  "Thinking",
  "Planning response",
  "Reasoning",
  "Analyzing",
  "Writing draft",
  "Formatting",
  "Finishing response",
];

// Short status label shown while the assistant is streaming but has no text yet.
// Derives from the latest running/last activity tool, so users see
// "Searching", "Reading Files", "Interacting with Gmail", etc.
function StreamingStatus({ activities }: { activities?: import("@/lib/chat-store").Activity[] }) {
  const last = activities && activities.length > 0 ? activities[activities.length - 1] : null;
  const tool = (last?.tool ?? "").toLowerCase();
  const [idleIdx, setIdleIdx] = useState(0);
  useEffect(() => {
    if (tool) return;
    const t = setInterval(() => setIdleIdx((i) => (i + 1) % IDLE_STATUSES.length), 2200);
    return () => clearInterval(t);
  }, [tool]);

  let label = IDLE_STATUSES[idleIdx];
  if (tool) {
    if (tool.includes("image")) label = "Creating Image";
    else if (tool.includes("gmail") || tool.includes("mail")) label = "Checking Gmail";
    else if (tool.includes("calendar")) label = "Checking Calendar";
    else if (tool.includes("drive") || tool.includes("file") || tool.includes("read")) label = "Reading documents";
    else if (tool.includes("memory") || tool.includes("recall")) label = "Searching memory";
    else if (tool.includes("search") || tool.includes("web") || tool.includes("browse")) label = "Searching the web";
    else if (tool.includes("write")) label = "Writing draft";
    else label = last?.label ?? "Working";
  }
  return (
    <div className="flex items-center gap-2 py-1" aria-live="polite">
      <span
        key={label}
        className="text-sm font-medium bg-clip-text text-transparent animate-in fade-in duration-300"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--color-muted-foreground) 0%, var(--color-foreground) 50%, var(--color-muted-foreground) 100%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.8s linear infinite",
        }}
      >
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
    } catch { /* ignore */ }
  }, [feedbackKey]);
  const persistFeedback = (next: "up" | "down" | null) => {
    setFeedback(next);
    try {
      if (next) localStorage.setItem(feedbackKey, next);
      else localStorage.removeItem(feedbackKey);
    } catch { /* ignore */ }
  };
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);


  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const { isSignedIn } = useUser();

  const saveFn = useServerFn(saveToLibrary);



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
    // Guests can save to a local-only library (kept in localStorage). The
    // ClerkSafe sign-in prompt is no longer shown here.

    // Duplicate-safe: stable per-message id stored in localStorage avoids re-saves.
    const dedupKey = "kovagpt:savedMessageIds";
    let savedIds: string[] = [];
    try {
      savedIds = JSON.parse(localStorage.getItem(dedupKey) || "[]");
    } catch { savedIds = []; }
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
        } catch { /* ignore */ }
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
    <div className="w-full px-4 lg:px-20 py-2.5 lg:py-3 group animate-fade-in text-[15px] leading-[1.6] lg:text-[16px] lg:leading-[1.65] [[data-sidebar=closed]_&]:lg:text-[17px] [[data-sidebar=closed]_&]:lg:py-4">
      {isUser ? (
        <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl flex justify-end">
          <div className="max-w-[85%] lg:max-w-[70%] flex flex-col items-end min-w-0">
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 justify-end">
                {message.attachments.map((a, i) => (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={message.content?.trim() ? `User-uploaded image: ${message.content.slice(0, 120)}` : "User-uploaded image attached to message"}
                    className="max-h-64 rounded-2xl border border-border"
                  />
                ))}
              </div>
            )}
            {message.content && (
              <div className="rounded-3xl bg-accent text-foreground px-4 py-2.5 lg:py-2.5 whitespace-pre-wrap break-words prose-chat shadow-sm">
                {message.content}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl flex items-start gap-3 lg:gap-4 justify-start animate-fade-up">
          <div className="flex-shrink-0 w-8 h-8 [[data-sidebar=closed]_&]:w-9 [[data-sidebar=closed]_&]:h-9 rounded-full flex items-center justify-center mt-0.5">
            <NovaLogo
              className="w-8 h-8 [[data-sidebar=closed]_&]:w-9 [[data-sidebar=closed]_&]:h-9"
              pulse={!!streaming}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-8 [[data-sidebar=closed]_&]:min-h-9 flex flex-col justify-center">
            {message.activities && message.activities.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {message.activities.map((a, i) => (
                  <span
                    key={i}
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
                  const hasChart = parts.some((p) => p.kind === "chart");
                  const md = hasChart ? (
                    <div className="space-y-2">
                      {parts.map((p, i) =>
                        p.kind === "chart" ? (
                          <ChatChart key={i} spec={p.spec} />
                        ) : p.value.trim() ? (
                          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{p.value}</ReactMarkdown>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
                  );
                  if (artifactKind || streaming) return md;
                  if (shouldWrapAsDocument(cleaned)) {
                    return <LongResponseCard content={cleaned}>{md}</LongResponseCard>;
                  }
                  const chip = detectInfoChip(cleaned);
                  if (chip) return <InfoChip kind={chip} rawText={cleaned}>{md}</InfoChip>;
                  return md;
                })()
              )}
              {streaming && message.content && <span className="cursor-blink" />}
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl">
        <div className={isUser ? "flex justify-end" : "pl-11 lg:pl-12"}>
          {!streaming && !isUser && message.content && (
            <div className="mt-2 flex flex-wrap items-center gap-1 transition-opacity">
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
              <button
                onClick={() => {
                  const next = feedback === "up" ? null : "up";
                  persistFeedback(next);
                  if (next) toast.success("Thanks for the feedback");
                }}
                className={`inline-flex items-center justify-center p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95 ${
                  feedback === "up" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                title="Good response"
                aria-label="Good response"
                aria-pressed={feedback === "up"}
              >
                <ThumbsUp className={`w-4 h-4 ${feedback === "up" ? "fill-current" : ""}`} />
              </button>
              <button
                onClick={() => {
                  const next = feedback === "down" ? null : "down";
                  persistFeedback(next);
                  if (next) toast.success("Thanks, we'll improve");
                }}
                className={`inline-flex items-center justify-center p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95 ${
                  feedback === "down" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                title="Bad response"
                aria-label="Bad response"
                aria-pressed={feedback === "down"}
              >
                <ThumbsDown className={`w-4 h-4 ${feedback === "down" ? "fill-current" : ""}`} />
              </button>
              <button
                onClick={async () => {
                  const text = message.content;
                  if (typeof navigator !== "undefined" && navigator.share) {
                    try {
                      await navigator.share({ text, title: "KovaGPT response" });
                      return;
                    } catch { /* user cancelled */ }
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
                  <DropdownMenuItem
                    onClick={() => {
                      if (onEdit) onEdit();
                      else toast.message("Edit your previous message above");
                    }}
                  >
                    <Pencil className="w-4 h-4 mr-2" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      if (onRetry) onRetry();
                      else toast.message("Retry available on the latest response");
                    }}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Retry
                  </DropdownMenuItem>
                  <DropdownMenuItem

                    onClick={() => {
                      if (onBranch) onBranch();
                      else toast.message("Branching coming to this chat");
                    }}
                  >
                    <GitBranch className="w-4 h-4 mr-2" /> Branch in new chat
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const q = encodeURIComponent(message.content.slice(0, 300));
                      window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer");
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
                        ? "Edit code"
                        : artifactKind === "code"
                          ? "Open code"
                          : "Open in editor"}
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
                        { label: "Shorter", prompt: "Rewrite your last response to be shorter, keeping the key points." },
                        { label: "Longer", prompt: "Expand your last response with more detail and examples." },
                        { label: "Improve", prompt: "Improve the wording and clarity of your last response." },
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
        <ArtifactEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          initialContent={editorContent}
          kind={artifactKind}
          onImprove={onFollowUp}
          initialMode={editorMode}
        />
      )}
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner);

