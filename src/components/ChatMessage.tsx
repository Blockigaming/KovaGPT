import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, User, Volume2, VolumeX, ImageIcon, Loader2, Bookmark, FileEdit, Code2, Eye } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";
import { speak, stopSpeaking, isSpeaking, ttsSupported } from "@/lib/voice";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
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
}: {
  message: Message;
  streaming?: boolean;
  voiceRate?: number;
  onFollowUp?: (prompt: string) => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ttsOk, setTtsOk] = useState(false);


  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const { isSignedIn } = useUser();
  const clerk = useClerkSafe();
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
    if (!isSignedIn) {
      clerk?.openSignIn();
      return;
    }
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
      await saveFn({
        data: {
          title,
          item_type: codeRatio ? "code" : "chat_artifact",
          source: "chat",
          content_text: message.content.slice(0, 100_000),
        },
      });
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
    <div className="w-full px-4 py-3 group">
      <div className="mx-auto max-w-3xl flex gap-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <NovaLogo className="w-8 h-8" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-1">{isUser ? "You" : "KovaGPT"}</div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.attachments.map((a, i) => (
                <img
                  key={i}
                  src={a.dataUrl}
                  alt={message.content?.trim() ? `User-uploaded image: ${message.content.slice(0, 120)}` : "User-uploaded image attached to message"}
                  className="max-h-64 rounded-lg border border-border"
                />
              ))}
            </div>
          )}
          {isUser ? (
            <div className="prose-chat whitespace-pre-wrap">{message.content}</div>
          ) : (
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
          )}
          {!streaming && !isUser && message.content && (
            <div className="mt-2 flex flex-wrap items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
                onClick={saveItem}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                title="Save to Library"
              >
                <Bookmark className={`w-3.5 h-3.5 ${saved ? "fill-current" : ""}`} />
                {saved ? "Saved" : saving ? "Saving…" : "Save"}
              </button>
              {artifactKind && (
                <button
                  onClick={() => {
                    setEditorMode("edit");
                    setEditorOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                  title={
                    artifactKind === "website"
                      ? "Edit website code"
                      : artifactKind === "code"
                        ? "Open code in editor"
                        : "Open in editor"
                  }
                >
                  {artifactKind === "writing" ? (
                    <FileEdit className="w-3.5 h-3.5" />
                  ) : (
                    <Code2 className="w-3.5 h-3.5" />
                  )}
                  {artifactKind === "website"
                    ? "Edit code"
                    : artifactKind === "code"
                      ? "Open code"
                      : "Open in editor"}
                </button>
              )}
              {artifactKind === "website" && (
                <button
                  onClick={() => {
                    setEditorMode("preview");
                    setEditorOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                  title="Preview website (static HTML/CSS only)"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview website
                </button>
              )}
              {onFollowUp && (
                <>
                  <span className="mx-1 h-3 w-px bg-border" aria-hidden />
                  {[
                    { label: "Continue", prompt: "Continue from where you left off." },
                    { label: "Shorter", prompt: "Rewrite your last response to be shorter, keeping the key points." },
                    { label: "Longer", prompt: "Expand your last response with more detail and examples." },
                    { label: "Improve", prompt: "Improve the wording and clarity of your last response." },
                  ].map((a) => (
                    <button
                      key={a.label}
                      onClick={() => onFollowUp(a.prompt)}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                      title={a.label}
                    >
                      {a.label}
                    </button>
                  ))}
                </>
              )}
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

