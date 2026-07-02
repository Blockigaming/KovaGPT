import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, Volume2, VolumeX, ImageIcon, Loader2, Bookmark, FileEdit, Code2, Eye, MoreHorizontal, Send, Pencil, RefreshCw, ThumbsUp, ThumbsDown, GitBranch, Globe } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { speak, stopSpeaking, isSpeaking, ttsSupported } from "@/lib/voice";
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
  voiceRate,
  onFollowUp,
  onRetry,
  onBranch,
  onEdit,
}: {
  message: Message;
  streaming?: boolean;
  voiceRate?: number;
  onFollowUp?: (prompt: string) => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ttsOk, setTtsOk] = useState(false);


  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const { isSignedIn } = useUser();
  
  const saveFn = useServerFn(saveToLibrary);
  useEffect(() => { setTtsOk(ttsSupported()); }, []);


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

  const toggleSpeak = () => {
    if (isSpeaking()) {
      stopSpeaking();
      setPlaying(false);
      return;
    }
    speak(message.content.replace(/```[\s\S]*?```/g, " code block ").replace(/[#*_`>]/g, ""), {
      rate: voiceRate ?? 1,
    });
    setPlaying(true);
    const i = setInterval(() => {
      if (!isSpeaking()) {
        setPlaying(false);
        clearInterval(i);
      }
    }, 400);
  };

  return (
    <div className="w-full px-4 py-3 group animate-fade-in">
      {isUser ? (
        <div className="mx-auto max-w-3xl flex justify-end">
          <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end min-w-0">
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
        <div className="mx-auto max-w-3xl flex gap-3 sm:gap-4 justify-start">
          <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
            <NovaLogo className="w-8 h-8" />
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
      <div className="mx-auto max-w-3xl">
        <div className={isUser ? "flex justify-end" : "sm:pl-12"}>
          {!streaming && !isUser && message.content && (
            <div className="mt-2 flex flex-wrap items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              {/* Visible: Copy, Read aloud, Send */}
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                title="Copy"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              {ttsOk && (
                <button
                  onClick={toggleSpeak}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                  title="Read aloud"
                >
                  {playing ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {playing ? "Stop" : "Read aloud"}
                </button>
              )}
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
                    toast.success("Response copied; ready to send");
                  } catch {
                    toast.error("Couldn't prepare for sending");
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                title="Send / share"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>

              {/* Everything else lives behind the 3-dot menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
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

