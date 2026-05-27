import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, User, Volume2, VolumeX, ImageIcon, Loader2 } from "lucide-react";
import { memo, useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";
import { speak, stopSpeaking, isSpeaking } from "@/lib/voice";

function ChatMessageInner({
  message,
  streaming,
  voiceRate,
}: {
  message: Message;
  streaming?: boolean;
  voiceRate?: number;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
    <div className="w-full px-4 py-6 group">
      <div className="mx-auto max-w-3xl flex gap-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center overflow-hidden">
              <NovaLogo className="w-6 h-6" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-1">{isUser ? "You" : "NovaGPT"}</div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.attachments.map((a, i) => (
                <img
                  key={i}
                  src={a.dataUrl}
                  alt="attachment"
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              )}
              {streaming && message.content && <span className="cursor-blink" />}
            </div>
          )}
          {!streaming && !isUser && message.content && (
            <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                title="Copy"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={toggleSpeak}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                title="Read aloud"
              >
                {playing ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {playing ? "Stop" : "Read aloud"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner);

