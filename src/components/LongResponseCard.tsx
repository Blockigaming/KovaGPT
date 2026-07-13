// Wraps long assistant responses (essays, reports, stories, letters) in a
// polished document container with Copy / Select All / Open in Writing /
// Download actions in the upper-right corner.
import { useRef, useState, type ReactNode } from "react";
import { Copy, Check, FileEdit, Download, MousePointerClick } from "lucide-react";
import { toast } from "sonner";

const LONG_RESPONSE_MIN_CHARS = 1200;
const LONG_RESPONSE_MIN_WORDS = 220;

// Skip wrapping when the response is dominated by code fences (handled by
// the artifact editor) or is mostly a bulleted list.
export function shouldWrapAsDocument(text: string): boolean {
  if (!text) return false;
  const chars = text.length;
  const words = text.trim().split(/\s+/).length;
  if (chars < LONG_RESPONSE_MIN_CHARS || words < LONG_RESPONSE_MIN_WORDS) return false;
  const codeFences = (text.match(/```/g) ?? []).length;
  if (codeFences >= 4) return false; // handled by artifact editor
  const bulletRatio =
    (text.match(/^\s*[-*+]\s/gm) ?? []).length / Math.max(1, text.split("\n").length);
  if (bulletRatio > 0.5) return false;
  return true;
}

function detectTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0].trim();
  const cleaned = firstLine
    .replace(/^#+\s+/, "")
    .replace(/^\*+\s*/, "")
    .replace(/[*_`]/g, "");
  if (cleaned.length > 4 && cleaned.length < 90) return cleaned;
  const firstSentence = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return firstSentence.split(" ").slice(0, 10).join(" ").slice(0, 80) || "Document";
}

function download(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* ignore */ }
}

export function LongResponseCard({
  content,
  children,
  onOpenInWriting,
}: {
  content: string;
  children: ReactNode;
  onOpenInWriting?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const title = detectTitle(content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const selectAll = () => {
    const node = bodyRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const dl = () => {
    const safe = title.replace(/[^a-z0-9\- ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document";
    download(`${safe}.md`, content);
  };

  const openInWriting = () => {
    if (onOpenInWriting) return onOpenInWriting();
    try {
      sessionStorage.setItem("kova-writing-draft", content);
    } catch { /* ignore */ }
    window.open("/write", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative my-3 rounded-2xl border border-border/60 bg-[#0a0a0a] text-neutral-100 shadow-md overflow-visible">
      <div className="sticky top-2 z-10 flex items-center justify-between gap-2 px-4 py-2 mx-2 mt-2 rounded-xl bg-[#0a0a0a]/95 backdrop-blur border border-white/5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Document</div>
          <div className="text-sm font-medium truncate text-neutral-100">{title}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={copy}
            title={copied ? "Copied" : "Copy"}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Copy"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={selectAll}
            title="Select all"
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Select all"
          >
            <MousePointerClick className="w-4 h-4" />
          </button>
          <button
            onClick={openInWriting}
            title="Open in Writing"
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Open in Writing"
          >
            <FileEdit className="w-4 h-4" />
          </button>
          <button
            onClick={dl}
            title="Download (.md)"
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Download"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={bodyRef} className="px-5 py-4 prose-chat prose-invert max-w-none text-neutral-100">
        {children}
      </div>
    </div>
  );
}
