import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bookmark,
  Check,
  Copy,
  Download,
  Eraser,
  History,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { authFetch } from "@/lib/auth-fetch";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createWritingDocument,
  listWritingDocuments,
  listWritingVersions,
  saveWritingDocument,
  type WritingDocument,
} from "@/lib/writing.functions";

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

const STORAGE_KEY = "kova.write.draft.v1";
const TITLE_KEY = "kova.write.title.v1";
const VERSIONS_KEY = "kova.write.versions.v1";
type DocumentVersion = { id: string; title: string; text: string; savedAt: number };

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
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [documents, setDocuments] = useState<WritingDocument[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState(1);
  const [saveStatus, setSaveStatus] = useState<"local" | "saving" | "saved" | "error" | "conflict">(
    "local",
  );
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastServerSnapshotRef = useRef("");
  const { isSignedIn, isLoaded } = useUser();
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);
  const listDocumentsFn = useServerFn(listWritingDocuments);
  const createDocumentFn = useServerFn(createWritingDocument);
  const saveDocumentFn = useServerFn(saveWritingDocument);
  const listVersionsFn = useServerFn(listWritingVersions);

  // Load draft
  useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      const ti = localStorage.getItem(TITLE_KEY);
      if (t) setText(t);
      if (ti) setTitle(ti);
      const storedVersions: unknown = JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? "[]");
      if (Array.isArray(storedVersions)) {
        setVersions(
          storedVersions
            .filter(
              (version): version is DocumentVersion =>
                Boolean(version) &&
                typeof version.id === "string" &&
                typeof version.title === "string" &&
                typeof version.text === "string" &&
                typeof version.savedAt === "number",
            )
            .slice(0, 20),
        );
      }
    } catch {
      // Ignore unavailable storage during draft restoration.
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    listDocumentsFn({})
      .then(async (rows) => {
        setDocuments(rows);
        const current = rows.find((row) => !row.archived_at) ?? null;
        if (!current) {
          const created = await createDocumentFn({
            data: { title: "Untitled document", content: "" },
          });
          setDocuments([created]);
          setDocumentId(created.id);
          setServerVersion(created.version);
          setSaveStatus("saved");
          lastServerSnapshotRef.current = `${created.title}\n${created.content}`;
          return;
        }
        setDocumentId(current.id);
        setServerVersion(current.version);
        setTitle(current.title);
        setText(current.content);
        lastServerSnapshotRef.current = `${current.title}\n${current.content}`;
        setSaveStatus("saved");
      })
      .catch(() => setSaveStatus("error"));
  }, [createDocumentFn, isLoaded, isSignedIn, listDocumentsFn]);

  useEffect(() => {
    if (!isSignedIn || !documentId) return;
    const snapshot = `${title}\n${text}`;
    if (snapshot === lastServerSnapshotRef.current) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveDocumentFn({
        data: {
          id: documentId,
          title,
          content: text,
          expectedVersion: serverVersion,
          source: "autosave",
        },
      })
        .then((savedDocument) => {
          setServerVersion(savedDocument.version);
          lastServerSnapshotRef.current = `${savedDocument.title}\n${savedDocument.content}`;
          setDocuments((current) =>
            current.map((item) => (item.id === savedDocument.id ? savedDocument : item)),
          );
          setSaveStatus("saved");
        })
        .catch((error) =>
          setSaveStatus(
            error instanceof Error && error.message.includes("changed elsewhere")
              ? "conflict"
              : "error",
          ),
        );
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [documentId, isSignedIn, saveDocumentFn, serverVersion, text, title]);

  const saveVersion = useCallback(() => {
    if (!text.trim()) return;
    const version = { id: crypto.randomUUID(), title, text, savedAt: Date.now() };
    setVersions((current) => {
      if (current[0]?.text === text && current[0]?.title === title) return current;
      const next = [version, ...current].slice(0, 20);
      try {
        localStorage.setItem(VERSIONS_KEY, JSON.stringify(next));
      } catch {
        toast.error("A version could not be saved on this device.");
      }
      return next;
    });
  }, [text, title]);

  useEffect(() => {
    if (!text.trim()) return;
    const timer = window.setTimeout(saveVersion, 30_000);
    return () => window.clearTimeout(timer);
  }, [saveVersion, text]);

  // Autosave to localStorage
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, text);
        localStorage.setItem(TITLE_KEY, title);
      } catch {
        // Ignore unavailable storage during draft persistence.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [text, title]);

  const words = useMemo(() => countWords(text), [text]);
  const chars = text.length;
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
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setText(prev);
      return s.slice(0, -1);
    });
  };

  const run = async (action: Action) => {
    if (busy) return;
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
      if (!res.ok || typeof json.text !== "string") {
        toast.error(json.error === "no_api_key" ? "AI is not configured" : "AI request failed");
        return;
      }
      applyResult(json.text, action);
      toast.success("Updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([`# ${title}\n\n${text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "document"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHtml = () => {
    const escape = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>${escape(title)}</h1><pre style="white-space:pre-wrap;font:inherit">${escape(text)}</pre></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "document"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportFile = async (format: "pdf" | "docx") => {
    setExporting(format);
    try {
      if (format === "pdf") {
        const { exportDocumentPdf } = await import("@/lib/writing-export/pdf");
        await exportDocumentPdf(title, text);
      } else {
        const { exportDocumentDocx } = await import("@/lib/writing-export/docx");
        await exportDocumentDocx(title, text);
      }
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error(`${format.toUpperCase()} export failed`);
    } finally {
      setExporting(null);
    }
  };

  const openVersionHistory = async () => {
    if (!isSignedIn || !documentId) {
      saveVersion();
      setHistoryOpen(true);
      return;
    }
    try {
      const rows = await listVersionsFn({ data: { documentId } });
      setVersions(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          text: row.content,
          savedAt: Date.parse(row.created_at),
        })),
      );
      setHistoryOpen(true);
    } catch {
      toast.error("Version history could not be loaded.");
    }
  };

  const clearAll = () => {
    if (!text.trim()) return;
    setClearOpen(true);
  };

  const confirmClear = () => {
    saveVersion();
    pushUndo(text);
    setText("");
    setClearOpen(false);
  };

  const save = async () => {
    if (!isSignedIn) {
      clerk?.openSignIn();
      return;
    }
    if (!text.trim()) {
      toast.error("Nothing to save");
      return;
    }
    setSaving(true);
    try {
      await saveFn({
        data: {
          title: title.slice(0, 200) || "Untitled document",
          item_type: "document",
          source: "manual",
          content_text: text.slice(0, 100_000),
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

  const newDocument = async () => {
    if (!isSignedIn) {
      saveVersion();
      setDocumentId(null);
      setTitle("Untitled document");
      setText("");
      return;
    }
    try {
      const created = await createDocumentFn({ data: { title: "Untitled document", content: "" } });
      setDocuments((current) => [created, ...current]);
      setDocumentId(created.id);
      setServerVersion(created.version);
      setTitle(created.title);
      setText(created.content);
      lastServerSnapshotRef.current = `${created.title}\n${created.content}`;
      setSaveStatus("saved");
    } catch {
      toast.error("Document could not be created.");
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
        <div className="mb-3 flex items-center gap-2">
          {isSignedIn && documents.length ? (
            <select
              className="h-10 min-w-0 max-w-xs rounded-xl border border-border bg-background px-3 text-sm"
              aria-label="Open document"
              value={documentId ?? ""}
              onChange={(event) => {
                const next = documents.find((item) => item.id === event.target.value);
                if (!next) return;
                setDocumentId(next.id);
                setServerVersion(next.version);
                setTitle(next.title);
                setText(next.content);
                lastServerSnapshotRef.current = `${next.title}\n${next.content}`;
              }}
            >
              {documents
                .filter((item) => !item.archived_at)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => void newDocument()}
            className="min-h-10 rounded-xl border border-border px-3 text-sm hover:bg-accent"
          >
            New document
          </button>
        </div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
          value={text}
          onChange={(e) => setText(e.target.value)}
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
            onClick={downloadHtml}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Download className="h-3 w-3" />
            Download HTML
          </button>
          <button
            onClick={() => void exportFile("docx")}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {exporting === "docx" ? "Exporting…" : "Download DOCX"}
          </button>
          <button
            onClick={() => void exportFile("pdf")}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {exporting === "pdf" ? "Exporting…" : "Download PDF"}
          </button>
          <button
            onClick={() => void openVersionHistory()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <History className="h-3 w-3" />
            Version history
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
        <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          {isSignedIn
            ? saveStatus === "saving"
              ? "Saving to your account…"
              : saveStatus === "saved"
                ? "Saved to your account"
                : saveStatus === "conflict"
                  ? "A newer copy exists. Reload before saving."
                  : saveStatus === "error"
                    ? "Could not save. Your local draft is preserved."
                    : "Preparing account storage…"
            : "Saved on this device only"}
        </p>
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Document version history</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto" aria-label="Document versions">
            {versions.length ? (
              versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    pushUndo(text);
                    setTitle(version.title);
                    setText(version.text);
                    setHistoryOpen(false);
                    toast.success("Version restored");
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{version.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(version.savedAt).toLocaleString()} · {countWords(version.text)}{" "}
                      words
                    </span>
                  </span>
                  <span className="text-xs font-medium">Restore</span>
                </button>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No saved versions yet.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear this document?"
        description="The current document will be saved to version history before it is cleared."
        confirmLabel="Clear document"
        destructive
        onConfirm={confirmClear}
      />
    </AppShell>
  );
}
