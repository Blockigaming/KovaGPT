import { ArrowUp, Square, Plus, X, Mic, Image as ImageIcon, FileText, Camera, Puzzle } from "lucide-react";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

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
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);

  const [sendFlash, setSendFlash] = useState(false);
  const [actionColor, setActionColor] = useState<string>("#3b82f6");
  const [plusOpen, setPlusOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef<string>("");

  useEffect(() => {
    if (!plusOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!plusWrapRef.current?.contains(e.target as Node)) setPlusOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setPlusOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [plusOpen]);



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
    <div className="w-full px-3 sm:px-6 lg:px-8 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
      <div className="mx-auto max-w-4xl [[data-sidebar=closed]_&]:max-w-5xl">
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
            <div className="flex items-center pl-2 pb-2 relative" ref={plusWrapRef}>
              <input
                ref={fileRef}
                type="file"
                accept="text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.yml,.yaml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sql,.sh,.bash,.env,.log,.srt,.vtt"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileChange}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => setPlusOpen((v) => !v)}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 transition ${plusOpen ? "rotate-45 text-foreground" : ""}`}
                aria-label="Attach"
                aria-haspopup="menu"
                aria-expanded={plusOpen}
                title="Add"
              >
                <Plus className="w-5 h-5 transition-transform" />
              </button>
              {plusOpen && (
                <div
                  role="menu"
                  className="absolute bottom-11 left-0 z-50 min-w-[200px] rounded-2xl border border-border bg-popover shadow-xl p-1.5 animate-in fade-in slide-in-from-bottom-1"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setPlusOpen(false); cameraRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left"
                  >
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span>Camera</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setPlusOpen(false); photoRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left"
                  >
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                    <span>Photos</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setPlusOpen(false); window.location.href = "/apps"; }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left"
                  >
                    <Puzzle className="w-4 h-4 text-muted-foreground" />
                    <span>Plugins</span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent text-left"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span>Files</span>
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder ?? "Ask Kova"}
              rows={1}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1 resize-none bg-transparent px-3 py-3 outline-none border-0 focus:ring-0 focus:outline-none text-foreground placeholder:text-muted-foreground max-h-[200px] leading-relaxed"
            />
            <div className="flex items-center gap-1 p-2">
              {mode && onModeChange && (
                <div className="hidden sm:block">
                  <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
                </div>
              )}
              {!isStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    const w = window as unknown as {
                      SpeechRecognition?: new () => SpeechRecognitionLike;
                      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
                    };
                    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
                    if (!Ctor) {
                      toast.error("Voice input isn't supported in this browser.");
                      return;
                    }
                    const rec = new Ctor();
                    rec.lang = "en-US";
                    rec.interimResults = false;
                    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
                      const transcript = e.results[0][0].transcript;
                      onChange((value ? value + " " : "") + transcript);
                    };
                    rec.onerror = () => toast.error("Couldn't hear you. Try again.");
                    try { rec.start(); } catch { /* ignore */ }
                  }}
                  className="w-9 h-9 rounded-full bg-accent/60 text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center transition"
                  aria-label="Voice input"
                  title="Voice input"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
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
                  className={`w-9 h-9 rounded-full text-white flex items-center justify-center shadow-sm hover:opacity-90 transition duration-150 active:scale-90 active:opacity-70 ${sendFlash ? "scale-90 opacity-80" : ""}`}
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
            <div className="flex items-center px-2 pb-2 sm:hidden">
              <ModelSelector mode={mode} onChange={onModeChange} userTier={userTier} compact />
            </div>
          )}
        </div>
      </div>
    </div>

  );
}
