import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef } from "react";

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim()) onSubmit();
    }
  };

  return (
    <div className="w-full px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end rounded-3xl border border-border bg-card shadow-lg focus-within:border-muted-foreground/50 transition-colors">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Message Nova GPT…"
            rows={1}
            className="flex-1 resize-none bg-transparent px-5 py-4 outline-none text-foreground placeholder:text-muted-foreground max-h-[200px]"
          />
          <div className="p-2">
            {isStreaming ? (
              <button
                onClick={onStop}
                className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-80 transition"
                aria-label="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!value.trim()}
                className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 transition"
                aria-label="Send"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Nova GPT can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
