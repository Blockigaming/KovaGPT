import { ArrowUp, Square, Mic, Plus, X, AudioLines } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRecognition, sttSupported } from "@/lib/voice";
import { tryUseUpload, DAILY_UPLOAD_LIMIT, getUsage } from "@/lib/limits";
import { toast } from "sonner";
import { ModelSelector } from "@/components/ModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

export type PendingAttachment = { kind: "image"; dataUrl: string; name: string };

const TEXT_LIKE_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|sh|bash|zsh|fish|env|ini|conf|log|srt|vtt)$/i;
const MAX_TEXT_FILE_BYTES = 256 * 1024; // 256 KB inline cap to keep prompts reasonable

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
  onOpenVoice,
  onUploadLimit,
  placeholder,
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
  onOpenVoice?: () => void;
  /** Called when the user hits their daily upload quota. */
  onUploadLimit?: () => void;
  placeholder?: string;
}) {

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (value.trim() || attachments.length > 0)) onSubmit();
    }
  };

  const toggleMic = () => {
    if (!sttSupported()) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = createRecognition(
      (text, isFinal) => {
        if (isFinal) onChange((value ? value + " " : "") + text);
      },
      () => setListening(false),
    );
    if (!rec) return;
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    let nextValue = value;
    for (const f of files) {
      const isImage = f.type.startsWith("image/");
      const isTextLike =
        f.type.startsWith("text/") ||
        f.type === "application/json" ||
        TEXT_LIKE_EXT.test(f.name);

      if (!isImage && !isTextLike) {
        toast.error(`${f.name}: unsupported file type. Attach an image or a text file.`);
        continue;
      }

      const u = getUsage();
      if (u.uploads >= DAILY_UPLOAD_LIMIT) {
        onUploadLimit?.();
        return;
      }
      if (!tryUseUpload()) {
        onUploadLimit?.();
        return;
      }

      if (isImage) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        onAttachmentsChange([...attachments, { kind: "image", dataUrl, name: f.name }]);
      } else {
        if (f.size > MAX_TEXT_FILE_BYTES) {
          toast.error(`${f.name} is too large (max 256 KB for text files).`);
          continue;
        }
        const text = await f.text();
        const lang = (f.name.split(".").pop() || "").toLowerCase();
        const block = `\n\nAttached file: ${f.name}\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        nextValue = (nextValue ? nextValue : "") + block;
      }
    }
    if (nextValue !== value) onChange(nextValue);
  };


  return (
    <div className="w-full px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-border bg-card shadow-lg focus-within:border-muted-foreground/50 transition-colors">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              {attachments.map((a, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                  <img src={a.dataUrl} alt="Uploaded image preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onAttachmentsChange(attachments.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-background/80 flex items-center justify-center hover:bg-background"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end">
            <div className="flex items-center pl-2 pb-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-9 h-9 rounded-full hover:bg-accent flex items-center justify-center transition"
                aria-label="Attach image"
                title="Attach image"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={listening ? "Listening…" : (placeholder ?? "Message NovaGPT…")}
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-4 outline-none text-foreground placeholder:text-muted-foreground max-h-[200px]"
            />
            <div className="flex items-center gap-1 p-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                  listening ? "bg-destructive text-destructive-foreground animate-pulse" : "hover:bg-accent"
                }`}
                aria-label="Voice input"
                title="Voice input"
              >
                <Mic className="w-4 h-4" />
              </button>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-80 transition"
                  aria-label="Stop"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : value.trim() || attachments.length > 0 ? (
                <button
                  type="button"
                  onClick={onSubmit}
                  className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-80 transition"
                  aria-label="Send"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              ) : onOpenVoice ? (
                <button
                  type="button"
                  onClick={onOpenVoice}
                  className="h-9 px-3 rounded-full bg-foreground text-background flex items-center gap-1.5 text-sm font-medium hover:opacity-80 transition"
                  aria-label="Voice mode"
                  title="Voice mode"
                >
                  <AudioLines className="w-4 h-4" />
                  <span>Voice</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center opacity-30 cursor-not-allowed"
                  aria-label="Send"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
          {mode && onModeChange && (
            <div className="flex items-center px-2 pb-2 -mt-1">
              <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
            </div>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          NovaGPT can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
