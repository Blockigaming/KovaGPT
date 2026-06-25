import { useEffect, useState } from "react";
import { Copy, Check, Bookmark, X, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";

export type ArtifactKind = "writing" | "code" | "website";

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
}: {
  open: boolean;
  onClose: () => void;
  initialContent: string;
  kind: ArtifactKind;
  onImprove?: (prompt: string) => void;
}) {
  const [value, setValue] = useState(initialContent);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { isSignedIn } = useUser();
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);

  useEffect(() => {
    if (open) {
      setValue(initialContent);
      setCopied(false);
      setSaved(false);
    }
  }, [open, initialContent]);

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
  const label =
    kind === "website" ? "Website draft" : kind === "code" ? "Code" : "Writing";

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
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {kind === "website" && (
              <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">
                preview disabled
              </span>
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

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={!isCode}
          className={`flex-1 w-full resize-none bg-background outline-none p-4 text-sm leading-relaxed ${
            isCode ? "font-mono" : ""
          }`}
          aria-label={`${label} content`}
        />

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
            <Bookmark
              className={`w-3.5 h-3.5 inline mr-1 ${saved ? "fill-current" : ""}`}
            />
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
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded hover:bg-accent"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
