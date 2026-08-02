import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Check, Copy, Download, Eraser, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
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
      { title: "Writing Workspace | KovaGPT" },
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

type Action =
  | "improve"
  | "expand"
  | "shorten"
  | "grammar"
  | "continue"
  | "tone"
  | "outline"
  | "custom";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const draftKey = isLoaded ? principalScopedStorageKey(STORAGE_KEY_BASE, userKey) : null;
  const titleKey = isLoaded ? principalScopedStorageKey(TITLE_KEY_BASE, userKey) : null;
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
        if (!storage) return;
        storage.setItem(draftKey, text);
        storage.setItem(titleKey, title);
        setDirty(false);
      } catch {
        // Ignore unavailable storage during draft persistence.
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
    await navigator.clipboard.writeText(text);
    if (generation !== storageGenerationRef.current || requestPrincipal !== principalRef.current)
      return;
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => {
      if (
        generation === storageGenerationRef.current &&
        requestPrincipal === principalRef.current
      ) {
        setCopied(false);
      }
    }, 1500);
  };

  const download = () => {
    if (!documentReady) return;
    const blob = new Blob([`# ${title}\n\n${text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "document"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    if (!documentReady) return;
    if (!text.trim()) return;
    if (!confirm("Clear the document? This cannot be undone.")) return;
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
      onClick={() => run(action)}
      disabled={!!busy}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
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
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <input
            value={visibleTitle}
            onChange={(e) => {
              if (!documentReady) return;
              setTitle(e.target.value);
              setDirty(true);
            }}
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground sm:text-3xl"
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
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-2 pr-1 py-0.5">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="bg-transparent text-xs outline-none"
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
              onClick={() => run("tone")}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
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
              onClick={undo}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Undo AI change
            </button>
          )}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom instruction - e.g. 'rewrite as a cover letter'"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <button
            onClick={() => run("custom")}
            disabled={!!busy || !custom.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
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
          onChange={(e) => {
            if (!documentReady) return;
            setText(e.target.value);
            setDirty(true);
          }}
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          placeholder="Start writing… Highlight text to transform only that section. Autosaved locally."
          className="min-h-[45vh] flex-1 w-full resize-none rounded-xl border border-border bg-background p-4 text-[15px] leading-relaxed outline-none focus:border-foreground/40 sm:p-6 sm:text-base sm:leading-8"
          spellCheck
          aria-label="Document content"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Download className="h-3 w-3" />
            Download .md
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Bookmark className={`h-3 w-3 ${saved ? "fill-current" : ""}`} />
            {saved ? "Saved" : saving ? "Saving…" : "Save to Library"}
          </button>
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
          <div className="ml-auto text-xs text-muted-foreground sm:hidden">
            {words.toLocaleString()} words
          </div>
        </div>
      </div>
    </AppShell>
  );
}
