import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Check,
  Bookmark,
  X,
  Wand2,
  Eye,
  Pencil,
  AlertTriangle,
  Download,
  History,
  ListTree,
  Columns2,
  RotateCcw,
  GitCompare,
  MessageSquare,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
import { addToContextPack, continueInResearch, openInWork } from "@/lib/workspace-handoffs";
import { RealtimeReadiness } from "@/components/RealtimeReadiness";

export type ArtifactKind = "writing" | "code" | "website";

type SessionVersion = { id: number; content: string; savedAt: number; label: string };

function documentOutline(value: string, isCode: boolean) {
  const lines = value.split("\n");
  return lines
    .map((line, index) => {
      const markdown = line.match(/^\s{0,3}(#{1,4})\s+(.+)/);
      const code = isCode
        ? line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+([\w$]+)/)
        : null;
      if (markdown) return { line: index + 1, label: markdown[2], depth: markdown[1].length };
      if (code) return { line: index + 1, label: code[1], depth: 1 };
      return null;
    })
    .filter((item): item is { line: number; label: string; depth: number } => Boolean(item))
    .slice(0, 80);
}

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
  const [splitView, setSplitView] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [comments, setComments] = useState<{ id: number; body: string; selection: string }[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [versions, setVersions] = useState<SessionVersion[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isSignedIn } = useUser();
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);
  const artifactTitle =
    kind === "code"
      ? "Code artifact"
      : kind === "website"
        ? "Website artifact"
        : "Writing artifact";

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
      const preferred = (() => {
        try {
          return (
            JSON.parse(localStorage.getItem("kova-workspace-defaults-v1") ?? "{}").artifact ?? ""
          );
        } catch {
          return "";
        }
      })();
      setMode(preferred === "Preview" && kind === "website" ? "preview" : initialMode);
      setSplitView(preferred === "Split view" && kind === "website");
      setOutlineOpen(false);
      setHistoryOpen(false);
      setSaveState("saved");
      setVersions([
        { id: Date.now(), content: initialContent, savedAt: Date.now(), label: "Original" },
      ]);
    }
  }, [open, initialContent, initialMode, canTruncate, kind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isCode = kind === "code" || kind === "website";
  const label = kind === "website" ? "Website draft" : kind === "code" ? "Code" : "Writing";
  const outline = documentOutline(value, isCode);
  const filteredOutline = outline.filter((item) =>
    item.label.toLowerCase().includes(outlineQuery.toLowerCase()),
  );
  const statistics = useMemo(() => {
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    return {
      words,
      characters: value.length,
      lines: value.split("\n").length,
      readingMinutes: Math.max(1, Math.ceil(words / 220)),
    };
  }, [value]);

  const updateValue = (next: string) => {
    setValue(next);
    setSaveState("unsaved");
  };

  const exportDocument = () => {
    const extension = kind === "writing" ? "md" : kind === "website" ? "html" : "txt";
    const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kova-${kind}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!open || saveState !== "unsaved") return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      setVersions((current) =>
        [
          { id: Date.now(), content: value, savedAt: Date.now(), label: "Autosaved" },
          ...current,
        ].slice(0, 20),
      );
      setSaveState("saved");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [open, saveState, value]);

  if (!open) return null;

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
        className="bg-background w-full sm:max-w-6xl sm:rounded-xl border border-border shadow-xl flex flex-col h-full sm:h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} editor`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
            <RealtimeReadiness resource="Artifact" />
            {kind === "website" && !splitView && (
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
            <span
              className="hidden text-xs text-muted-foreground sm:inline"
              aria-live="polite"
              role="status"
            >
              {saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : "Saved"}
            </span>
            <span className="hidden text-xs text-muted-foreground lg:inline">
              {statistics.words.toLocaleString()} words · {statistics.readingMinutes} min read ·{" "}
              {statistics.lines.toLocaleString()} lines
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOutlineOpen((v) => !v)}
              className="kova-icon-button"
              aria-label="Toggle document outline"
              aria-pressed={outlineOpen}
            >
              <ListTree className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCommentsOpen((v) => !v)}
              className="kova-icon-button"
              aria-label="Toggle artifact comments"
              aria-pressed={commentsOpen}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="kova-icon-button"
              aria-label="Toggle version history"
              aria-pressed={historyOpen}
            >
              <History className="h-4 w-4" />
            </button>
            {kind === "website" ? (
              <button
                onClick={() => setSplitView((v) => !v)}
                className="kova-icon-button"
                aria-label="Toggle split view"
                aria-pressed={splitView}
              >
                <Columns2 className="h-4 w-4" />
              </button>
            ) : null}
            <button onClick={onClose} className="kova-icon-button" aria-label="Close editor">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {outlineOpen ? (
            <aside
              className="hidden w-56 shrink-0 overflow-y-auto border-r border-border p-3 md:block"
              aria-label="Document outline"
            >
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outline
              </h2>
              <label className="relative mb-2 block">
                <span className="sr-only">Search outline</span>
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={outlineQuery}
                  onChange={(event) => setOutlineQuery(event.target.value)}
                  className="h-8 w-full rounded-lg border bg-background pl-7 pr-2 text-xs"
                  placeholder="Find heading"
                />
              </label>
              {filteredOutline.length ? (
                filteredOutline.map((item) => (
                  <button
                    key={`${item.line}-${item.label}`}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    style={{ paddingLeft: `${item.depth * 8}px` }}
                    onClick={() => {
                      const area = textareaRef.current;
                      if (!area) return;
                      const start =
                        value
                          .split("\n")
                          .slice(0, item.line - 1)
                          .join("\n").length + (item.line > 1 ? 1 : 0);
                      area.focus();
                      area.setSelectionRange(start, start);
                    }}
                  >
                    {item.label}
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  {outline.length ? "No headings match." : "Add headings to build an outline."}
                </p>
              )}
            </aside>
          ) : null}
          <div className={`min-w-0 flex-1 ${splitView ? "grid md:grid-cols-2" : "flex flex-col"}`}>
            {kind === "website" && mode === "preview" && !splitView ? (
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
                      Showing the first {LONG_THRESHOLD.toLocaleString()} characters for
                      performance. Full content is preserved.
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
                  ref={textareaRef}
                  value={value}
                  onChange={(e) => updateValue(e.target.value)}
                  spellCheck={!isCode}
                  className={`flex-1 w-full resize-none bg-background outline-none p-4 text-sm leading-relaxed ${
                    isCode ? "font-mono" : ""
                  }`}
                  aria-label={`${label} content`}
                />
              </div>
            )}
            {splitView ? (
              <div className="min-h-[40vh] border-l border-border bg-white">
                <iframe
                  title="Live split preview"
                  srcDoc={preview.doc}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  className="h-full min-h-[40vh] w-full bg-white"
                />
              </div>
            ) : null}
          </div>
          {historyOpen ? (
            <aside
              className="w-64 shrink-0 overflow-y-auto border-l border-border bg-[var(--surface-secondary)] p-3"
              aria-label="Version history"
            >
              <h2 className="mb-1 text-sm font-semibold">Version history</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Session versions are kept while this Canvas is open.
              </p>
              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="rounded-lg border border-border bg-background p-2"
                  >
                    <div className="text-xs font-medium">{version.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(version.savedAt).toLocaleTimeString()}
                    </div>
                    <button
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
                      onClick={() => {
                        updateValue(version.content);
                        toast.success("Version restored");
                      }}
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </button>
                    <button
                      className="ml-3 mt-2 inline-flex items-center gap-1 text-xs font-medium"
                      onClick={() => setCompareVersion(version.id)}
                    >
                      <GitCompare className="h-3 w-3" /> Compare
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          ) : null}
          {commentsOpen ? (
            <aside
              className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] w-full shrink-0 overflow-y-auto rounded-t-2xl border bg-[var(--surface-secondary)] p-3 shadow-xl md:static md:max-h-none md:w-72 md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none"
              aria-label="Artifact comments"
            >
              <h2 className="text-sm font-semibold">Comments</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Comments stay with this open editing session.
              </p>
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                className="mt-3 min-h-20 w-full rounded-lg border bg-background p-2 text-xs"
                placeholder="Comment on the document or current selection"
                aria-label="Artifact comment"
              />
              <button
                disabled={!commentDraft.trim()}
                onClick={() => {
                  const area = textareaRef.current;
                  const selection = area ? value.slice(area.selectionStart, area.selectionEnd) : "";
                  setComments((current) => [
                    {
                      id: Date.now(),
                      body: commentDraft.trim(),
                      selection: selection.slice(0, 160),
                    },
                    ...current,
                  ]);
                  setCommentDraft("");
                }}
                className="mt-2 min-h-9 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"
              >
                Add comment
              </button>
              {comments.length === 0 ? (
                <p className="mt-4 text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {comments.map((comment) => (
                    <li key={comment.id} className="rounded-lg border bg-background p-2 text-xs">
                      {comment.selection && (
                        <blockquote className="mb-2 border-l-2 pl-2 text-muted-foreground">
                          {comment.selection}
                        </blockquote>
                      )}
                      <p>{comment.body}</p>
                      <button
                        onClick={() =>
                          setComments((current) =>
                            current.filter((value) => value.id !== comment.id),
                          )
                        }
                        className="mt-2 text-destructive"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          ) : null}
        </div>

        {compareVersion && versions.find((version) => version.id === compareVersion) ? (
          <div
            className="max-h-[38vh] overflow-auto border-t bg-muted/30 p-3"
            aria-label="Version comparison"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Compare current with{" "}
                {versions.find((version) => version.id === compareVersion)?.label}
              </h2>
              <button
                onClick={() => setCompareVersion(null)}
                className="min-h-9 rounded-lg px-3 text-xs hover:bg-accent"
              >
                Close comparison
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <section>
                <h3 className="mb-1 text-xs font-medium">Selected revision</h3>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 text-xs">
                  {versions.find((version) => version.id === compareVersion)?.content}
                </pre>
              </section>
              <section>
                <h3 className="mb-1 text-xs font-medium">Current revision</h3>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 text-xs">
                  {value}
                </pre>
              </section>
            </div>
          </div>
        ) : null}

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
            onClick={exportDocument}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            <Download className="mr-1 inline h-3.5 w-3.5" /> Export
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            <Bookmark className={`w-3.5 h-3.5 inline mr-1 ${saved ? "fill-current" : ""}`} />
            {saved ? "Saved" : saving ? "Saving…" : "Save to Library"}
          </button>
          <button
            onClick={() =>
              openInWork({ type: "artifact", id: kind, title: artifactTitle, content: value })
            }
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Open in Work
          </button>
          <button
            onClick={() =>
              continueInResearch({
                type: "artifact",
                id: kind,
                title: artifactTitle,
                content: value,
              })
            }
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Research
          </button>
          <button
            onClick={() =>
              addToContextPack({ type: "artifact", id: kind, title: artifactTitle, content: value })
            }
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Add to Context Pack
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
