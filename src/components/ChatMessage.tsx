import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, User } from "lucide-react";
import { useState } from "react";
import type { Message } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";

export function ChatMessage({ message, streaming }: { message: Message; streaming?: boolean }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
            <NovaLogo className="w-8 h-8" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-1">{isUser ? "You" : "Nova GPT"}</div>
          {isUser ? (
            <div className="prose-chat whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className={`prose-chat ${streaming && !message.content ? "cursor-blink" : ""}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {streaming && message.content && <span className="cursor-blink" />}
            </div>
          )}
          {!streaming && !isUser && message.content && (
            <button
              onClick={copy}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              title="Copy"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
