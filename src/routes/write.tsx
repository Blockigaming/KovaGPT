import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Check, Copy, Download, Eraser, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { authFetch } from "@/lib/auth-fetch";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/write")({
  head: () => ({
    meta: [
      { title: "KovaGPT Writing" },
      {
        name: "description",
        content:
          "A distraction-free long-form editor with AI actions: improve, expand, shorten, fix grammar, and rewrite in any tone.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WritePage,
});

const STORAGE_KEY_BASE = "kova-write-draft";
const TITLE_KEY_BASE = "kova-write-title";
const VERSIONS_KEY_BASE = "kova.write.versions.v1";

type Action =
  "improve" | "expand" | "shorten" | "grammar" | "continue" | "tone" | "outline" | "custom";

function countWords(t: string) {
  const m = t.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function WritePage() {
  const [title, setTitle] = useState("Untitled document");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [tone, setTone] = useState("professional");
  const [custom, setCustom] = useState("");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const draftKey = isLoaded ? principalScopedStorageKey(STORAGE_KEY_BASE, userKey) : null;
  const titleKey = isLoaded ? principalScopedStorageKey(TITLE_KEY_BASE, userKey) : null;
  const versionsKey = isLoaded ? principalScopedStorageKey(VERSIONS_KEY_BASE, userKey) : null;
  const storageGenerationRef = useRef(0);
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const [documentPrincipal, setDocumentPrincipal] = useState<string | null>(null);
  const documentReady = principal !== null && documentPrincipal === principal;
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);

  // Load draft
  useEffect(() => {
    const generation = storageGenerationRef.current + 1;
    storageGenerationRef.current = generation;
    setText("");
    setTitle("Untitled document");
    setUndoStack([]);
    setBusy(null);
    setSaving(false);
    setSaved(false);
    setCopied(false);
    setSelection({ start: 0, end: 0 });
    setTone("professional");
    setCustom("");
    setDirty(false);
    setAutosaveError(null);
    setDocumentPrincipal(null);
    if (!principal || !draftKey || !titleKey) return;
    try {
      const storage = safeBrowserStorage("localStorage");
      const t = storage?.getItem(draftKey);
      const ti = storage?.getItem(titleKey);
      if (generation !== storageGenerationRef.current) return;
      if (t) setText(t);
      if (ti) setTitle(ti);
    } catch {
      // Ignore unavailable storage during draft restoration.
    }
    if (generation === storageGenerationRef.current) setDocumentPrincipal(principal);
  }, [draftKey, principal, titleKey]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      storageGenerationRef.current += 1;
      setText("");
      setTitle("Untitled document");
      setUndoStack([]);
      setBusy(null);
      setSaving(false);
      setSaved(false);
      setCopied(false);
      setSelection({ start: 0, end: 0 });
      setTone("professional");
      setCustom("");
      setDirty(false);
      setAutosaveError(null);
      setDocumentPrincipal(principal);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  // Autosave to localStorage
  useEffect(() => {
    if (!documentReady || !dirty || !draftKey || !titleKey) return;
    const generation = storageGenerationRef.current;
    const requestPrincipal = principal;
    const id = setTimeout(() => {
      if (generation !== storageGenerationRef.current || requestPrincipal !== principalRef.current)
        return;
      try {
        const storage = safeBrowserStorage("localStorage");
        if (!storage) throw new Error("Browser storage is unavailable.");
        storage.setItem(draftKey, text);
        storage.setItem(titleKey, title);
        setDirty(false);
        setAutosaveError(null);
      } catch {
        setAutosaveError(
          "This draft could not be autosaved in this browser. Keep this tab open and copy or download your work.",
        );
      }
    }, 400);
    return () => clearTimeout(id);
  }, [dirty, documentReady, draftKey, principal, text, title, titleKey]);

  const visibleText = documentReady ? text : "";
  const visibleTitle = documentReady ? title : "Untitled document";
  const words = useMemo(() => countWords(visibleText), [visibleText]);
  const chars = visibleText.length;
  const readMin = Math.max(1, Math.round(words / 220));

  const captureSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    setSelection({ start: el.selectionStart, end: el.selectionEnd });
  };

  const pushUndo = useCallback((snapshot: string) => {
    setUndoStack((s) => [...s.slice(-19), snapshot]);
  }, []);

  const applyResult = (result: string, action: Action) => {
    pushUndo(text);
    setDirty(true);
    if (action === "continue") {
      setText((prev) => (prev.endsWith("\n") ? prev + result : prev + "\n\n" + result));
      return;
    }
    // If a non-trivial selection exists, replace it.
    const { start, end } = selection;
    if (end > start && end - start >= 4) {
      setText((prev) => prev.slice(0, start) + result + prev.slice(end));
      return;
    }
    setText(result);
  };

  const undo = () => {
    if (!documentReady) return;
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setText(prev);
      setDirty(true);
      return s.slice(0, -1);
    });
  };

  const run = async (action: Action) => {
    if (busy || !documentReady) return;
    const generation = storageGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === storageGenerationRef.current && requestPrincipal === principalRef.current;
    const { start, end } = selection;
    const selected = end > start ? text.slice(start, end) : "";
    const source = selected && selected.length >= 4 ? selected : text;
    if (action !== "custom" && action !== "outline" && !source.trim()) {
      toast.error("Write something first");
      return;
    }
    setBusy(action);
    try {
      const res = await authFetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: source,
          action,
          tone: action === "tone" ? tone : undefined,
          instructions: action === "custom" ? custom : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!isCurrent()) return;
      if (!res.ok || typeof json.text !== "string") {
        toast.error(json.error === "no_api_key" ? "AI is not configured" : "AI request failed");
        return;
      }
      applyResult(json.text, action);
      toast.success("Updated");
    } catch (e) {
      if (isCurrent()) toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const copy = async () => {
    if (!documentReady) return;
    const generation = storageGenerationRef.current;
    const requestPrincipal = principal;
    try {
      await navigator.clipboard.writeText(text);
      if (generation !== storageGenerationRef.current || requestPrincipal !== principalRef.current)
        return;
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => {
        if (
          generation === storageGenerationRef.current &&
          requestPrincipal === principalRef.current
        ) {
          setCopied(false);
        }
      }, 1500);
    } catch {
      if (
        generation === storageGenerationRef.current &&
        requestPrincipal === principalRef.current
      ) {
        toast.error("Could not copy the document. Select the text and copy it manually.");
      }
    }
  };

  const downloadBlob = (blob: Blob, extension: string) => {
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "document"}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      const completedUrl = url;
      url = null;
      window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1_000);
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };

  const download = () => {
    if (!documentReady) return;
    try {
      downloadBlob(new Blob([`# ${title}\n\n${text}`], { type: "text/markdown" }), "md");
      toast.success("Markdown downloaded");
    } catch {
      toast.error("Markdown download failed");
    }
  };

  const exportDocument = async (format: "docx" | "pdf" | "xlsx" | "pptx" | "html") => {
    if (!documentReady) return;
    const generation = storageGenerationRef.current;
    const actor = principal;
    const current = () =>
      generation === storageGenerationRef.current && actor === principalRef.current;
    try {
      if (format !== "html") {
        const { downloadDocument } = await import("@/lib/writing-export/export");
        if (!current() || !(await downloadDocument(format, title, text, current))) return;
      } else {
        const escapeHtml = (value: string) =>
          value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        downloadBlob(
          new Blob(
            [
              `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><pre>${escapeHtml(text)}</pre>`,
            ],
            { type: "text/html" },
          ),
          "html",
        );
      }
      if (current()) toast.success("Document exported");
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : "Document export failed");
    }
  };

  const saveVersion = () => {
    if (!versionsKey || !documentReady) return;
    try {
      const storage = safeBrowserStorage("localStorage");
      if (!storage) throw new Error("Browser storage is unavailable.");
      const existing = storage.getItem(versionsKey);
      const parsed = existing ? (JSON.parse(existing) as unknown) : [];
      const versions = Array.isArray(parsed)
        ? parsed.filter(
            (item): item is { title: string; text: string } =>
              item !== null &&
              typeof item === "object" &&
              typeof item.title === "string" &&
              typeof item.text === "string",
          )
        : [];
      storage.setItem(versionsKey, JSON.stringify([{ title, text }, ...versions].slice(0, 20)));
      toast.success("Document version saved");
    } catch {
      toast.error("Document version could not be saved in this browser");
    }
  };

  const restoreLatestVersion = () => {
    if (!versionsKey || !documentReady) return;
    try {
      const storage = safeBrowserStorage("localStorage");
      if (!storage) throw new Error("Browser storage is unavailable.");
      const existing = storage.getItem(versionsKey);
      if (!existing) {
        toast.message("No saved document versions yet");
        return;
      }
      const parsed = JSON.parse(existing) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Invalid document version history.");
      const latest = parsed.find(
        (item): item is { title: string; text: string } =>
          item !== null &&
          typeof item === "object" &&
          typeof item.title === "string" &&
          typeof item.text === "string",
      );
      if (!latest) {
        toast.message("No saved document versions yet");
        return;
      }
      pushUndo(text);
      setTitle(latest.title);
      setText(latest.text);
      setDirty(true);
      toast.success("Version restored");
    } catch {
      toast.error("Saved document versions could not be read");
    }
  };

  const clearAll = () => {
    if (!documentReady) return;
    if (!text.trim()) return;
    pushUndo(text);
    setText("");
    setDirty(true);
  };

  const save = async () => {
    if (!documentReady) return;
    if (!isSignedIn) {
      clerk?.openSignIn();
      return;
    }
    if (!text.trim()) {
      toast.error("Nothing to save");
      return;
    }
    setSaving(true);
    const generation = storageGenerationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === storageGenerationRef.current && requestPrincipal === principalRef.current;
    try {
      await saveFn({
        data: {
          title: title.slice(0, 200) || "Untitled document",
          item_type: "document",
          source: "manual",
          content_text: text.slice(0, 100_000),
        },
      });
      if (!isCurrent()) return;
      setSaved(true);
      toast.success("Saved to Library");
      setTimeout(() => {
        if (isCurrent()) setSaved(false);
      }, 2000);
    } catch (e) {
      if (isCurrent()) toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  const actionButton = (action: Action, label: string, Icon: typeof Sparkles = Sparkles) => (
    <button
      type="button"
      onClick={() => run(action)}
      disabled={!!busy || !documentReady}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
    >
      {busy === action ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {label}
    </button>
  );

  return (
    <AppShell>
      <div
        className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-8 sm:py-10"
        aria-busy={!documentReady}
      >
        {!documentReady && (
          <div role="status" className="mb-3 text-sm text-muted-foreground">
            Loading document…
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <input
            value={visibleTitle}
            disabled={!documentReady}
            onChange={(e) => {
              if (!documentReady) return;
              setTitle(e.target.value);
              setDirty(true);
            }}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground sm:text-3xl"
            placeholder="Untitled document"
            aria-label="Document title"
          />
          <div className="hidden text-xs text-muted-foreground sm:block">
            {words.toLocaleString()} words · {chars.toLocaleString()} chars · ~{readMin} min read
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {actionButton("improve", "Improve", Wand2)}
          {actionButton("grammar", "Fix grammar")}
          {actionButton("shorten", "Shorten")}
          {actionButton("expand", "Expand")}
          {actionButton("continue", "Continue")}
          {actionButton("outline", "Outline")}
          <div className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2 pr-1">
            <select
              value={tone}
              disabled={!documentReady}
              onChange={(e) => setTone(e.target.value)}
              className="min-h-11 bg-transparent text-xs outline-none"
              aria-label="Tone"
            >
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="friendly">Friendly</option>
              <option value="confident">Confident</option>
              <option value="playful">Playful</option>
              <option value="academic">Academic</option>
              <option value="persuasive">Persuasive</option>
              <option value="concise">Concise</option>
            </select>
            <button
              type="button"
              onClick={() => run("tone")}
              disabled={!!busy || !documentReady}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {busy === "tone" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Rewrite
            </button>
          </div>
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={undo}
              className="ml-auto inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground"
            >
              Undo AI change
            </button>
          )}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <input
            value={custom}
            disabled={!documentReady}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom instruction - e.g. 'rewrite as a cover letter'"
            className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <button
            type="button"
            onClick={() => run("custom")}
            disabled={!!busy || !custom.trim() || !documentReady}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy === "custom" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Apply
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={visibleText}
          disabled={!documentReady}
          onChange={(e) => {
            if (!documentReady) return;
            setText(e.target.value);
            setDirty(true);
          }}
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          placeholder="Start writing… Highlight text to transform only that section."
          className="min-h-[45vh] flex-1 w-full resize-none rounded-xl border border-border bg-background p-4 text-[15px] leading-relaxed outline-none focus:border-foreground/40 sm:p-6 sm:text-base sm:leading-8"
          spellCheck
          aria-label="Document content"
        />
        <p
          role={autosaveError ? "alert" : "status"}
          className={`mt-2 text-xs ${autosaveError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {autosaveError ??
            (dirty
              ? "Saving draft locally…"
              : "Draft changes are saved locally in this browser when storage is available.")}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={!documentReady || !text}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            Download .md
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !documentReady}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Bookmark className={`h-3 w-3 ${saved ? "fill-current" : ""}`} />
            {saved ? "Saved" : saving ? "Saving…" : "Save to Library"}
          </button>
          <button
            type="button"
            onClick={() => setClearOpen(true)}
            disabled={!documentReady || !text.trim()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
          <button
            type="button"
            onClick={saveVersion}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
          >
            Save version
          </button>
          <button
            type="button"
            onClick={restoreLatestVersion}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
          >
            Restore latest
          </button>
          <button
            type="button"
            onClick={() => void exportDocument("docx")}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
          >
            Download DOCX
          </button>
          <button
            type="button"
            onClick={() => void exportDocument("pdf")}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
          >
            Download PDF
          </button>
          {(["xlsx", "pptx"] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => void exportDocument(format)}
              disabled={!documentReady}
              className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
            >
              Download {format.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void exportDocument("html")}
            disabled={!documentReady}
            className="inline-flex min-h-11 items-center text-xs underline disabled:opacity-50"
          >
            Download HTML
          </button>
          <div className="ml-auto text-xs text-muted-foreground sm:hidden">
            {words.toLocaleString()} words
          </div>
        </div>
        <ConfirmActionDialog
          open={clearOpen}
          onOpenChange={setClearOpen}
          title="Clear document?"
          description="This removes the current text from this device."
          confirmLabel="Clear"
          destructive
          onConfirm={clearAll}
        />
      </div>
    </AppShell>
  );
}
