import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Bookmark, X, Wand2, Eye, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";

export type ArtifactKind = "writing" | "code" | "website";

// Split an editor value back into pieces using the "// --- Block N ---"
// markers that ChatMessage injects when joining multiple code blocks.
function splitEditorBlocks(value: string): string[] {
  const parts = value
    .split(/\n?\/\/ --- Block \d+ ---\n?/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [value];
}

function looksLikeCss(piece: string): boolean {
  const t = piece.trim();
  if (t.startsWith("<")) return false;
  return /[^{}]+\{[^}]*[a-z-]+\s*:\s*[^}]+\}/i.test(t) && !/<[a-z!/]/i.test(t);
}

function stripUnsafe(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "blocked:");
}

export function buildPreviewDoc(value: string): { doc: string; hadScripts: boolean } {
  const blocks = splitEditorBlocks(value);
  const cssParts: string[] = [];
  const htmlParts: string[] = [];
  for (const b of blocks) {
    if (looksLikeCss(b)) cssParts.push(b);
    else htmlParts.push(b);
  }
  const rawHtml = htmlParts.join("\n").trim();
  const hadScripts = /<script\b|\son[a-z]+\s*=|javascript:/i.test(rawHtml);
  const sanitized = stripUnsafe(rawHtml);
  const css = cssParts.join("\n\n");
  const styleTag = css ? `<style>${css}</style>` : "";
  const hasFullDoc = /<html[\s>]/i.test(sanitized) || /<!doctype/i.test(sanitized);
  let doc: string;
  if (hasFullDoc) {
    if (styleTag && /<head[\s>]/i.test(sanitized)) {
      doc = sanitized.replace(/<\/head>/i, `${styleTag}</head>`);
    } else if (styleTag) {
      doc = sanitized.replace(/<html[^>]*>/i, (m) => `${m}<head>${styleTag}</head>`);
    } else {
      doc = sanitized;
    }
  } else {
    doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">${styleTag}</head><body>${sanitized}</body></html>`;
  }
  return { doc, hadScripts };
}

export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].replace(/\s+$/, ""));
  return blocks;
}

export function detectArtifactKind(text: string): ArtifactKind | null {
  const blocks = extractCodeBlocks(text);
  if (blocks.length > 0) {
    const all = blocks.join("\n").toLowerCase();
    const looksWebsite =
      /<html|<!doctype|<body|<head|<div[\s>]|<section|<main|className=|class=/.test(all) ||
      /export\s+default\s+function\s+\w+\s*\(/.test(all);
    return looksWebsite ? "website" : "code";
  }
  // long-form prose
  if (text.length >= 600 || text.split(/\n+/).length >= 8) return "writing";
  return null;
}

export function ArtifactEditor({
  open,
  onClose,
  initialContent,
  kind,
  onImprove,
  initialMode = "edit",
}: {
  open: boolean;
  onClose: () => void;
  initialContent: string;
  kind: ArtifactKind;
  onImprove?: (prompt: string) => void;
  initialMode?: "edit" | "preview";
}) {
  const LONG_THRESHOLD = 50_000;
  const canTruncate = kind === "writing" && initialContent.length > LONG_THRESHOLD;
  const [value, setValue] = useState(initialContent);
  const [truncated, setTruncated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">(initialMode);
  const { isSignedIn } = useUser();
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);

  const preview = useMemo(
    () => (kind === "website" ? buildPreviewDoc(value) : { doc: "", hadScripts: false }),
    [kind, value],
  );

  useEffect(() => {
    if (open) {
      if (canTruncate) {
        setValue(initialContent.slice(0, LONG_THRESHOLD));
        setTruncated(true);
      } else {
        setValue(initialContent);
        setTruncated(false);
      }
      setCopied(false);
      setSaved(false);
      setMode(initialMode);
    }
  }, [open, initialContent, initialMode, canTruncate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isCode = kind === "code" || kind === "website";
  const label = kind === "website" ? "Website draft" : kind === "code" ? "Code" : "Writing";

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    if (!isSignedIn) {
      clerk?.openSignIn();
      return;
    }
    setSaving(true);
    try {
      const item_type =
        kind === "website" ? "website_draft" : kind === "code" ? "code" : "document";
      const title =
        kind === "website"
          ? "Website draft (edited)"
          : kind === "code"
            ? "Code draft (edited)"
            : "Writing draft (edited)";
      await saveFn({
        data: {
          title,
          item_type,
          source: "chat",
          content_text: value.slice(0, 100_000),
        },
      });
      setSaved(true);
      toast.success("Saved to Library");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const improve = () => {
    if (!onImprove) return;
    const trimmed = value.trim().slice(0, 8000);
    const prompt =
      kind === "writing"
        ? `Improve the following text. Keep meaning intact, tighten prose, fix grammar, and return only the improved version.\n\n${trimmed}`
        : kind === "website"
          ? `Improve the following website draft. Keep structure, improve accessibility, semantics, and styling. Return only the updated code.\n\n${trimmed}`
          : `Improve the following code. Keep behavior, improve clarity, naming, and safety. Return only the updated code.\n\n${trimmed}`;
    onImprove(prompt);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-background w-full sm:max-w-3xl sm:rounded-xl border border-border shadow-xl flex flex-col h-full sm:h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} editor`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
            {kind === "website" && (
              <div className="ml-2 inline-flex rounded border border-border overflow-hidden">
                <button
                  onClick={() => setMode("edit")}
                  className={`text-xs px-2 py-1 inline-flex items-center gap-1 ${mode === "edit" ? "bg-accent" : "hover:bg-accent"}`}
                  aria-pressed={mode === "edit"}
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button
                  onClick={() => setMode("preview")}
                  className={`text-xs px-2 py-1 inline-flex items-center gap-1 ${mode === "preview" ? "bg-accent" : "hover:bg-accent"}`}
                  aria-pressed={mode === "preview"}
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-accent"
            aria-label="Close editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {kind === "website" && mode === "preview" ? (
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {preview.hadScripts && (
              <div className="flex items-start gap-2 px-3 py-2 text-xs bg-yellow-50 text-yellow-900 border-b border-yellow-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Preview only supports static HTML/CSS. JavaScript is not run for safety.
                </span>
              </div>
            )}
            <iframe
              title="Website preview"
              srcDoc={preview.doc}
              sandbox=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="flex-1 w-full bg-white"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {truncated && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs bg-yellow-50 text-yellow-900 border-b border-yellow-200">
                <span>
                  Showing the first {LONG_THRESHOLD.toLocaleString()} characters for performance.
                  Full content is preserved.
                </span>
                <button
                  onClick={() => {
                    setValue(initialContent);
                    setTruncated(false);
                  }}
                  className="px-2 py-1 rounded border border-yellow-300 hover:bg-yellow-100 whitespace-nowrap"
                >
                  Load full content
                </button>
              </div>
            )}
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={!isCode}
              className={`flex-1 w-full resize-none bg-background outline-none p-4 text-sm leading-relaxed ${
                isCode ? "font-mono" : ""
              }`}
              aria-label={`${label} content`}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-t border-border">
          <button
            onClick={() => copy(initialContent)}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            <Copy className="w-3.5 h-3.5 inline mr-1" />
            Copy original
          </button>
          <button
            onClick={() => copy(value)}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 inline mr-1" />
            ) : (
              <Copy className="w-3.5 h-3.5 inline mr-1" />
            )}
            {copied ? "Copied" : "Copy edited"}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            <Bookmark className={`w-3.5 h-3.5 inline mr-1 ${saved ? "fill-current" : ""}`} />
            {saved ? "Saved" : saving ? "Saving…" : "Save to Library"}
          </button>
          {onImprove && (
            <button
              onClick={improve}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
            >
              <Wand2 className="w-3.5 h-3.5 inline mr-1" />
              Improve with KovaGPT
            </button>
          )}
          <div className="ml-auto">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded hover:bg-accent">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
