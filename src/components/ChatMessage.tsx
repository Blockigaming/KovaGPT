import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ImageIcon, Loader2, Bookmark, FileEdit, Code2, Eye, MoreHorizontal, Share2, Pencil, RefreshCw, ThumbsUp, ThumbsDown, GitBranch, Globe } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser } from "@/components/auth/ClerkSafe";
import { ArtifactEditor, detectArtifactKind, extractCodeBlocks } from "./ArtifactEditor";

// Strip numbered citation markers like [1], [2], [3] that web-search-augmented
// answers sometimes still inject, and normalize en/em dashes to a hyphen
// so the assistant never shows them in the UI.
function cleanAssistantText(text: string): string {
  return text
    .replace(/\s?\[\d+\](?:\[\d+\])*/g, "")
    .replace(/\s?\[\d+(?:\s*,\s*\d+)+\]/g, "")
    .replace(/[\u2013\u2014]/g, "-");
}



function ChatMessageInner({
  message,
  streaming,
  onFollowUp,
  onRetry,
  onBranch,
  onEdit,
}: {
  message: Message;
  streaming?: boolean;
  
  onFollowUp?: (prompt: string) => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
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
    <div className="w-full px-6 sm:px-12 lg:px-20 py-3 group animate-fade-in text-[15px] [[data-sidebar=closed]_&]:text-[17px] [[data-sidebar=closed]_&]:py-4">
      {isUser ? (
        <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl flex justify-end">
          <div className="max-w-[80%] sm:max-w-[70%] flex flex-col items-end min-w-0">
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
              <div className="rounded-3xl bg-accent text-foreground px-4 py-2.5 whitespace-pre-wrap break-words prose-chat">
                {message.content}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl flex gap-3 sm:gap-4 justify-start">
          <div className="flex-shrink-0 w-8 h-8 [[data-sidebar=closed]_&]:w-9 [[data-sidebar=closed]_&]:h-9 rounded-full flex items-center justify-center">
            <NovaLogo className="w-8 h-8 [[data-sidebar=closed]_&]:w-9 [[data-sidebar=closed]_&]:h-9" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="prose-chat">
              {message.pendingImage && !message.content ? (
                <div className="flex items-center gap-3 px-4 py-6 rounded-xl bg-accent/40 border border-border w-fit">
                  <div className="relative">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    <Loader2 className="w-4 h-4 absolute -bottom-1 -right-1 animate-spin text-primary" />
                  </div>
                  <div className="text-sm text-muted-foreground">Generating image…</div>
                </div>
              ) : streaming && !message.content ? (
                <div className="thinking-dots" aria-label="Thinking">
                  <span /><span /><span />
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {cleanAssistantText(message.content)}
                </ReactMarkdown>
              )}
              {streaming && message.content && <span className="cursor-blink" />}
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl">
        <div className={isUser ? "flex justify-end" : "pl-11 sm:pl-12"}>
          {!streaming && !isUser && message.content && (
            <div className="mt-2 flex flex-wrap items-center gap-1 transition-opacity">
              {/* Visible: Copy, Thumbs up, Thumbs down, Share */}
              <button
                onClick={copy}
                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent transition-all hover:scale-[1.08] active:scale-95"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy"}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => {
                  setFeedback((f) => (f === "up" ? null : "up"));
                  toast.success("Thanks for the feedback");
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
                  setFeedback((f) => (f === "down" ? null : "down"));
                  toast.success("Thanks, we'll improve");
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
                      setFeedback((f) => (f === "up" ? null : "up"));
                      toast.success("Thanks for the feedback");
                    }}
                  >
                    <ThumbsUp className={`w-4 h-4 mr-2 ${feedback === "up" ? "fill-current" : ""}`} /> Like
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setFeedback((f) => (f === "down" ? null : "down"));
                      toast.success("Thanks, we'll improve");
                    }}
                  >
                    <ThumbsDown className={`w-4 h-4 mr-2 ${feedback === "down" ? "fill-current" : ""}`} /> Dislike
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

