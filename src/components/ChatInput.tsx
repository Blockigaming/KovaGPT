import { ArrowUp, Square, Plus, X, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  /** Called when the user hits their daily upload quota. */
  onUploadLimit?: () => void;
  placeholder?: string;
}) {

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [sendFlash, setSendFlash] = useState(false);
  const [actionColor, setActionColor] = useState<string>("#3b82f6");
  const [listening, setListening] = useState(false);


  useEffect(() => {
    try {
      const c = localStorage.getItem("kova-action-color");
      if (c && /^#[0-9a-f]{6}$/i.test(c)) setActionColor(c);
    } catch { /* ignore */ }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "kova-action-color" && e.newValue && /^#[0-9a-f]{6}$/i.test(e.newValue)) {
        setActionColor(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    const onLocal = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (typeof ce.detail === "string" && /^#[0-9a-f]{6}$/i.test(ce.detail)) setActionColor(ce.detail);
    };
    window.addEventListener("kova-action-color", onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("kova-action-color", onLocal as EventListener);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const triggerSubmit = () => {
    setSendFlash(true);
    window.setTimeout(() => setSendFlash(false), 380);
    onSubmit();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (value.trim() || attachments.length > 0)) triggerSubmit();
    }
  };

  const toggleDictation = () => {
    const SR: any =
      typeof window !== "undefined" &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!SR) {
      toast.error("Dictation isn't supported in this browser.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
    let baseText = value;
    let finalAppend = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalAppend += r[0].transcript;
        else interim += r[0].transcript;
      }
      const glue = baseText && !baseText.endsWith(" ") ? " " : "";
      onChange(baseText + glue + finalAppend + interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      baseText = "";
      finalAppend = "";
    };
    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
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
    <div className="w-full px-6 sm:px-12 lg:px-20 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
      <div className="mx-auto max-w-3xl [[data-sidebar=closed]_&]:max-w-4xl">
        <div
          style={
            sendFlash
              ? ({ boxShadow: `0 0 0 2px ${actionColor}33`, borderColor: `${actionColor}99` } as React.CSSProperties)
              : undefined
          }
          className={`rounded-3xl border bg-card shadow-lg transition-all duration-200 focus-within:border-muted-foreground/50 ${
            sendFlash
              ? "scale-[0.995]"
              : isStreaming
                ? "border-foreground/40 ring-1 ring-foreground/10"
                : "border-border"
          }`}
        >
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
                accept="image/*,text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-9 h-9 rounded-full hover:bg-accent flex items-center justify-center transition"
                aria-label="Attach file"
                title="Attach image or text file"

              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder ?? "Message KovaGPT…"}
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-4 outline-none text-foreground placeholder:text-muted-foreground max-h-[200px]"
            />
            <div className="flex items-center gap-1 p-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  style={{ backgroundColor: actionColor }}
                  className="w-9 h-9 rounded-full text-white flex items-center justify-center hover:opacity-80 transition"
                  aria-label="Stop"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : value.trim() || attachments.length > 0 ? (
                <button
                  type="button"
                  onClick={triggerSubmit}
                  style={{ backgroundColor: actionColor }}
                  className={`w-9 h-9 rounded-full text-white flex items-center justify-center hover:opacity-90 transition duration-150 active:scale-90 active:opacity-70 ${
                    sendFlash ? "scale-90 opacity-80" : ""
                  }`}
                  aria-label="Send"
                >
                  <ArrowUp className={`w-5 h-5 transition-transform duration-300 ${sendFlash ? "-translate-y-1.5 opacity-0" : ""}`} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  style={{ backgroundColor: actionColor }}
                  className="w-9 h-9 rounded-full text-white flex items-center justify-center opacity-30 cursor-not-allowed"
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
          KovaGPT can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
