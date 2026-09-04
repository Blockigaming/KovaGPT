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
import { listMessageVersions, saveMessageVersion } from "@/lib/chat-workspace.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
import { addToContextPack, continueInResearch, openInWork } from "@/lib/workspace-handoffs";
import { RealtimeReadiness } from "@/components/RealtimeReadiness";
import { buildPreviewDoc, type ArtifactKind } from "./artifact-utils";
import { createSerializedWriteQueue } from "@/lib/serialized-write-queue";
import {
  canApplyLoadedArtifactHistory,
  recoverFailedArtifactSnapshot,
} from "@/lib/canvas-autosave-policy.mjs";

type SessionVersion = {
  id: number;
  content: string;
  savedAt: number;
  label: string;
  /** True when this entry is stored server-side and survives closing Canvas. */
  durable?: boolean;
};

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

export function ArtifactEditor({
  open,
  onClose,
  initialContent,
  kind,
  onImprove,
  initialMode = "edit",
  chatId,
  messageId,
}: {
  open: boolean;
  onClose: () => void;
  initialContent: string;
  kind: ArtifactKind;
  onImprove?: (prompt: string) => void;
  initialMode?: "edit" | "preview";
  /**
   * When both ids are present and the user is signed in, edits are recorded as
   * durable message versions instead of session-only history.
   */
  chatId?: string | null;
  messageId?: string | null;
}) {
  const [value, setValue] = useState(initialContent);
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
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "session_only">(
    "saved",
  );
  const [versions, setVersions] = useState<SessionVersion[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastRecordedValueRef = useRef(initialContent);
  const lastScheduledValueRef = useRef(initialContent);
  const autosaveGenerationRef = useRef(0);
  const localEditRevisionRef = useRef(0);
  const autosaveQueueRef = useRef(createSerializedWriteQueue());
  const [autosaveRetryNonce, setAutosaveRetryNonce] = useState(0);
  const { isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);
  const listVersionsFn = useServerFn(listMessageVersions);
  const saveVersionFn = useServerFn(saveMessageVersion);
  const canPersistVersions = Boolean(isSignedIn && chatId && messageId);
  const [historyError, setHistoryError] = useState<string | null>(null);
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
    // Opening, closing, or replacing an artifact invalidates all asynchronous
    // work captured by the previous Canvas session.
    autosaveGenerationRef.current += 1;
    if (open) {
      localEditRevisionRef.current = 0;
      lastRecordedValueRef.current = initialContent;
      lastScheduledValueRef.current = initialContent;
      setValue(initialContent);
      setCopied(false);
      setSaved(false);
      let preferred: string | undefined;

      try {
        preferred =
          JSON.parse(localStorage.getItem("kova-workspace-defaults-v1") ?? "{}").artifact ?? "";
      } catch {
        /* Invalid local preferences fall back to the requested initial mode. */
      }
      setMode(preferred === "Preview" && kind === "website" ? "preview" : initialMode);
      setSplitView(preferred === "Split view" && kind === "website");
      setOutlineOpen(false);
      setHistoryOpen(false);
      setSaveState("saved");
      setVersions([
        { id: Date.now(), content: initialContent, savedAt: Date.now(), label: "Original" },
      ]);
      setHistoryError(null);
    }
  }, [open, initialContent, initialMode, kind]);

  // Load durable versions for this message so history survives closing Canvas.
  useEffect(() => {
    if (!open || !canPersistVersions || !chatId || !messageId) return;
    let cancelled = false;
    const loadEditRevision = localEditRevisionRef.current;
    void (async () => {
      try {
        const rows = await listVersionsFn({ data: { chatId, messageId } });
        if (cancelled) return;
        const durable = rows
          .slice()
          .reverse()
          .map((row) => ({
            id: new Date(row.createdAt).getTime() + row.version,
            content: row.content,
            savedAt: new Date(row.createdAt).getTime(),
            label: `Saved v${row.version}${row.accepted ? " (current)" : ""}`,
            durable: true,
          }));
        if (durable.length > 0) {
          setVersions((current) => [...durable, ...current].slice(0, 30));
          const accepted = rows.find((row) => row.accepted);
          if (accepted) {
            // Reopen the server-accepted edit, but never replace text the user
            // already changed while version history was loading.
            setValue((current) => {
              if (!canApplyLoadedArtifactHistory(loadEditRevision, localEditRevisionRef.current)) {
                return current;
              }
              lastRecordedValueRef.current = accepted.content;
              lastScheduledValueRef.current = accepted.content;
              return accepted.content;
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        setHistoryError(
          error instanceof Error ? error.message : "Saved versions could not be loaded.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, canPersistVersions, chatId, messageId, initialContent, listVersionsFn]);

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
    localEditRevisionRef.current += 1;
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
    // Compare with the latest scheduled snapshot, not only the last completed
    // write. If edit A is in flight and the user reverts to the prior value,
    // that revert still needs to queue behind A.
    if (!open || value === lastScheduledValueRef.current) return;
    let cancelled = false;
    const snapshot = value;
    const generation = autosaveGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      lastScheduledValueRef.current = snapshot;
      setSaveState("saving");
      void (async () => {
        // Persist first, then label the entry honestly: only a resolved server
        // write may be shown as saved beyond this session.
        let durable = false;
        if (canPersistVersions && chatId && messageId && snapshot.trim()) {
          try {
            // The accepted version is a last-write-wins server value. Queue
            // requests in edit order so a slow older request can never arrive
            // after and replace a newer snapshot.
            await autosaveQueueRef.current.enqueue(() =>
              saveVersionFn({
                data: {
                  chatId,
                  messageId,
                  source: "inline_edit",
                  content: snapshot,
                  originalContent: initialContent,
                  accepted: true,
                },
              }),
            );
            // A later edit cancels this effect's UI work, but it does not
            // cancel an already-started server write. Preserve that successful
            // durable value for failure recovery within the same artifact.
            if (autosaveGenerationRef.current === generation) {
              lastRecordedValueRef.current = snapshot;
            }
            durable = true;
            if (!cancelled) setHistoryError(null);
          } catch (error) {
            const recovery = recoverFailedArtifactSnapshot({
              failedSnapshot: snapshot,
              scheduledSnapshot: lastScheduledValueRef.current,
              durableSnapshot: lastRecordedValueRef.current,
              generation,
              currentGeneration: autosaveGenerationRef.current,
              effectCancelled: cancelled,
            });
            if (recovery.scheduledSnapshot !== lastScheduledValueRef.current) {
              // Invalidate only this failed latest snapshot. A genuinely newer
              // scheduled edit must retain its comparison point.
              lastScheduledValueRef.current = recovery.scheduledSnapshot;
              setHistoryError(
                error instanceof Error
                  ? error.message
                  : "This edit is only kept for the current session.",
              );
              if (recovery.retryCurrentValue) {
                // The effect that owned the failed write was cancelled, so its
                // visible value otherwise has no effect left to retry it.
                setAutosaveRetryNonce((nonce) => nonce + 1);
              }
            }
          }
        }
        if (cancelled) return;
        if (!canPersistVersions && autosaveGenerationRef.current === generation) {
          lastRecordedValueRef.current = snapshot;
        }
        setVersions((current) =>
          [
            {
              id: Date.now(),
              content: snapshot,
              savedAt: Date.now(),
              label: durable ? "Saved to this chat" : "Session only",
              durable,
            },
            ...current,
          ].slice(0, 30),
        );
        setSaveState(durable ? "saved" : "session_only");
      })();
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    open,
    value,
    canPersistVersions,
    chatId,
    messageId,
    initialContent,
    saveVersionFn,
    autosaveRetryNonce,
  ]);

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
    if (value.length > 200_000) {
      toast.error(
        "This draft is too large for Library. Export it to download the complete file instead.",
      );
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
          content_text: value,
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
    const start = textareaRef.current?.selectionStart ?? 0;
    const end = textareaRef.current?.selectionEnd ?? 0;
    const selected = end > start ? value.slice(start, end) : value;
    const trimmed = selected.trim();
    if (!trimmed) {
      toast.error("Add some content to improve first.");
      return;
    }
    if (trimmed.length > 8000) {
      toast.error("Improve supports up to 8,000 characters at once. Select a shorter section.");
      return;
    }
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
              {saveState === "saving"
                ? "Saving…"
                : saveState === "unsaved"
                  ? "Unsaved"
                  : saveState === "session_only"
                    ? "Session only"
                    : "Saved"}
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
                {canPersistVersions
                  ? "Edits are saved to this chat and stay available after you close Canvas."
                  : "Versions are kept only while this Canvas is open."}
              </p>
              {historyError ? (
                <p role="alert" className="mb-3 text-xs text-destructive">
                  {historyError}
                </p>
              ) : null}
              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="rounded-lg border border-border bg-background p-2"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      {version.label}
                      {version.durable ? null : (
                        <span className="rounded bg-muted px-1 py-px text-[10px] font-normal text-muted-foreground">
                          not saved
                        </span>
                      )}
                    </div>
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
              openInWork(
                { type: "artifact", id: kind, title: artifactTitle, content: value },
                userKey,
              )
            }
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Open in Work
          </button>
          <button
            onClick={() =>
              continueInResearch(
                {
                  type: "artifact",
                  id: kind,
                  title: artifactTitle,
                  content: value,
                },
                userKey,
              )
            }
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Research
          </button>
          <button
            onClick={() =>
              addToContextPack(
                { type: "artifact", id: kind, title: artifactTitle, content: value },
                userKey,
              )
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
