import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { SelectionEditDialog, type SelectionTarget } from "./SelectionEditDialog";
import { ResultServerExportDialog } from "./ResultServerExportDialog";
import { downloadBytes, safeDocumentFilename } from "@/lib/writing-export/common";
import "./result-editor.css";
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
  Undo2,
  Redo2,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import { useUser, useClerkSafe } from "@/components/auth/ClerkSafe";
import { addToContextPack, continueInChat, openInWork } from "@/lib/workspace-handoffs";
import { CollaborationStatus } from "@/components/CollaborationStatus";
import { CanvasComments } from "@/components/CanvasComments";
import {
  ResultCommentDeleteDialog,
  type ResultCommentDeleteTarget,
} from "@/components/ResultCommentDeleteDialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { useScopedActionFeedback } from "@/lib/use-scoped-action-feedback";
import { useCanvasCollaboration } from "@/lib/use-canvas-collaboration";
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
  remoteRevision?: number;
};

type ResultFocusOrigin = {
  target: HTMLElement | null;
  url: string;
  scope: string;
  generation: number;
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

export type ResultDescriptor = {
  title: string;
  initialContent: string;
  kind: ArtifactKind;
  initialMode?: "edit" | "preview";
  chatId?: string | null;
  messageId?: string | null;
  projectId?: string | null;
};

type ArtifactEditorProps = {
  title?: string;
  embedded?: boolean;
  onDraftChange?: (content: string) => void;
  /** Tabbed layouts keep the reset action in More rather than adding an empty split-control row. */
  onResetLayout?: () => void;
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
  projectId?: string | null;
};
export function ArtifactEditor(props: ArtifactEditorProps) {
  const { user } = useUser();
  if (!props.open) return null;
  return (
    <ArtifactEditorSession
      key={JSON.stringify([user?.id, props.chatId, props.messageId, props.projectId])}
      {...props}
    />
  );
}
function ArtifactEditorSession({
  open,
  onClose,
  initialContent,
  kind,
  onImprove,
  initialMode = "edit",
  chatId,
  messageId,
  projectId,
  title,
  embedded = false,
  onDraftChange,
  onResetLayout,
}: ArtifactEditorProps) {
  const [value, setValue] = useState(initialContent);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current?.(value);
  }, [value]);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [shareSnapshot, setShareSnapshot] = useState<string | null>(null);
  const [closeReview, setCloseReview] = useState(false);
  const [serverExportOpen, setServerExportOpen] = useState(false);
  const serverExportReturnRef = useRef<ResultFocusOrigin | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const closeReviewReturnRef = useRef<(ResultFocusOrigin & { discard: boolean }) | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const resultRootRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultCloseRef = useRef<HTMLButtonElement>(null);
  const compareReturnRef = useRef<ResultFocusOrigin | null>(null);
  const [rewriteTarget, setRewriteTarget] = useState<SelectionTarget | null>(null);
  const [copyError, setCopyError] = useState(false);
  const librarySavedValue = useRef<string | null>(null);
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
  const commentDraftRef = useRef(commentDraft);
  commentDraftRef.current = commentDraft;
  const commentFieldId = useId();
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<ResultCommentDeleteTarget | null>(
    null,
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "session_only">(
    "session_only",
  );
  const [versions, setVersions] = useState<SessionVersion[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastRecordedValueRef = useRef(initialContent);
  const lastScheduledValueRef = useRef(initialContent);
  const autosaveGenerationRef = useRef(0);
  const localEditRevisionRef = useRef(0);
  const editOriginRef = useRef("User edit");
  const [acknowledgedEditRevision, setAcknowledgedEditRevision] = useState(0);
  const pendingAutosavesRef = useRef(0);
  const autosaveQueueRef = useRef(createSerializedWriteQueue());
  const [autosaveRetryNonce, setAutosaveRetryNonce] = useState(0);
  const { isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const resultScope = JSON.stringify([userKey, chatId, messageId, projectId, kind, initialContent]);
  const actionFeedback = useScopedActionFeedback(resultScope);
  const historyScopeRef = useRef(resultScope);
  historyScopeRef.current = resultScope;
  const historyActiveRef = useRef(true);
  const historyVisibleRef = useRef(historyOpen);
  historyVisibleRef.current = historyOpen;
  const historyScrollRef = useRef(0);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyRequestRef = useRef(0);
  const historyPreviewTicketRef = useRef<ReturnType<typeof actionFeedback.begin>>(null);
  const historyReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    scope: string;
    generation: number;
  } | null>(null);
  const closeHistory = () => {
    if (!historyActiveRef.current || historyScopeRef.current !== resultScope) return;
    historyVisibleRef.current = false;
    // This read-only inspector never discards the working draft or selected comparison.
    historyRequestRef.current += 1;
    const ticket = historyPreviewTicketRef.current;
    historyPreviewTicketRef.current = null;
    if (ticket) actionFeedback.finish(ticket);
    setHistoryOpen(false);
  };
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clerk = useClerkSafe();
  const saveFn = useServerFn(saveToLibrary);
  const canPersistVersions = Boolean(isSignedIn && chatId && messageId);
  const collaboration = useCanvasCollaboration({
    open,
    actorId: canPersistVersions ? userKey : null,
    chatId,
    messageId,
    projectId,
    initialContent,
  });
  const saveVersionFn = collaboration.save;
  const [historyError, setHistoryError] = useState<string | null>(null);
  const artifactTitle =
    title?.trim() ||
    initialContent.match(/^#{1,3}\s+(.+)$/m)?.[1]?.slice(0, 120) ||
    (kind === "writing" ? "Writing result" : kind === "website" ? "Website result" : "Code result");
  const resultFocusIsCurrent = (origin: ResultFocusOrigin | null) =>
    Boolean(
      origin &&
      historyActiveRef.current &&
      origin.scope === historyScopeRef.current &&
      origin.generation === autosaveGenerationRef.current &&
      window.location.href === origin.url &&
      resultRootRef.current?.isConnected,
    );
  const resultOwnsFocus = (origin: ResultFocusOrigin, surface: EventTarget | null) => {
    const active = document.activeElement;
    return (
      active === null ||
      active === document.body ||
      active === origin.target ||
      (surface instanceof HTMLElement && (surface === active || surface.contains(active)))
    );
  };
  const restoreResultFocus = (origin: ResultFocusOrigin, surface: EventTarget | null) => {
    if (!resultFocusIsCurrent(origin) || !resultOwnsFocus(origin, surface)) return;
    const target = [
      origin.target,
      textareaRef.current,
      resultCloseRef.current,
      resultHeadingRef.current,
    ].find(
      (candidate) =>
        candidate?.isConnected &&
        resultRootRef.current?.contains(candidate) &&
        candidate.getClientRects().length &&
        !candidate.closest('[inert], [aria-hidden="true"]') &&
        !candidate.matches(':disabled, [aria-disabled="true"]'),
    );
    restoreDialogFocus(target, origin.url);
  };
  const requestClose = (target?: HTMLElement) => {
    if (!historyActiveRef.current || historyScopeRef.current !== resultScope || closeReview) return;
    if (librarySavedValue.current === value) {
      onClose();
      return;
    }
    if (
      saveState === "saving" ||
      saveState === "unsaved" ||
      (saveState === "session_only" && value !== initialContent)
    ) {
      const active = target ?? document.activeElement;
      closeReviewReturnRef.current = {
        target:
          active instanceof HTMLElement && resultRootRef.current?.contains(active) ? active : null,
        url: window.location.href,
        scope: resultScope,
        generation: autosaveGenerationRef.current,
        discard: false,
      };
      setCloseReview(true);
    } else onClose();
  };
  const closeReviewOrigin = closeReviewReturnRef.current;
  const compareOrigin = compareReturnRef.current;
  const serverExportOrigin = serverExportReturnRef.current;

  const preview = useMemo(
    () => (kind === "website" ? buildPreviewDoc(value) : { doc: "", hadScripts: false }),
    [kind, value],
  );

  useEffect(() => {
    // Opening, closing, or replacing an artifact invalidates all asynchronous
    // work captured by the previous Canvas session.
    autosaveGenerationRef.current += 1;
    historyActiveRef.current = true;
    historyVisibleRef.current = false;
    historyScrollRef.current = 0;
    historyReturnRef.current = null;
    historyRequestRef.current += 1;
    historyPreviewTicketRef.current = null;
    closeReviewReturnRef.current = null;
    compareReturnRef.current = null;
    if (open) {
      setCloseReview(false);
      setCompareVersion(null);
      localEditRevisionRef.current = 0;
      setAcknowledgedEditRevision(0);
      lastRecordedValueRef.current = initialContent;
      lastScheduledValueRef.current = initialContent;
      setValue(initialContent);
      setCopied(false);
      setCopyError(false);
      setSaved(false);
      setSaving(false);
      setDeleteCommentTarget(null);
      clearTimeout(savedTimerRef.current);
      let preferred: string | undefined;

      try {
        preferred =
          JSON.parse(localStorage.getItem("kova-workspace-defaults-v1") ?? "{}").artifact ?? "";
      } catch {
        /* Invalid local preferences fall back to the requested initial mode. */
      }
      // Generated previews require an explicit Run preview action each session.
      setMode("edit");
      setSplitView(false);
      setUndoStack([]);
      setRedoStack([]);
      setOutlineOpen(false);
      setHistoryOpen(false);
      setSaveState("session_only");
      setVersions([
        { id: Date.now(), content: initialContent, savedAt: Date.now(), label: "Original" },
      ]);
      setHistoryError(null);
      setComments([]);
      setCommentDraft("");
      setCommentsOpen(false);
    }
    return () => {
      autosaveGenerationRef.current += 1;
      historyActiveRef.current = false;
      historyReturnRef.current = null;
      historyRequestRef.current += 1;
      historyPreviewTicketRef.current = null;
      closeReviewReturnRef.current = null;
      compareReturnRef.current = null;
      clearTimeout(savedTimerRef.current);
    };
  }, [open, initialContent, initialMode, kind, userKey, chatId, messageId, projectId]);

  // Canonical snapshots never replace a dirty local edit. Version content is
  // fetched only on restore/compare, keeping realtime refreshes bounded.
  const remoteSnapshot = collaboration.snapshot;
  const adoptRemote = collaboration.adopt;
  useEffect(() => {
    if (!open || !remoteSnapshot) return;
    const durable = remoteSnapshot.versions.map((row) => ({
      id: row.revision,
      content:
        row.revision === remoteSnapshot.document.revision ? remoteSnapshot.document.content : "",
      savedAt: new Date(row.created_at).getTime(),
      label: `Saved v${row.revision}${row.revision === remoteSnapshot.document.revision ? " (current)" : ""}`,
      durable: true,
      remoteRevision: row.revision,
    }));
    setVersions((current) =>
      [
        ...durable.map((row) => ({
          ...row,
          content:
            row.remoteRevision === remoteSnapshot.document.revision
              ? row.content
              : (current.find((existing) => existing.remoteRevision === row.remoteRevision)
                  ?.content ?? ""),
        })),
        ...current.filter((row) => !row.durable),
      ].slice(0, 50),
    );
    if (
      canApplyLoadedArtifactHistory(acknowledgedEditRevision, localEditRevisionRef.current) &&
      pendingAutosavesRef.current === 0
    ) {
      const content = adoptRemote();
      if (content !== null) {
        lastRecordedValueRef.current = content;
        lastScheduledValueRef.current = content;
        setValue(content);
        setSaveState("saved");
      }
    }
  }, [open, remoteSnapshot, adoptRemote, value, acknowledgedEditRevision]);

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

  const updateValue = (next: string, recordUndo = true, origin = "User edit") => {
    editOriginRef.current = origin;
    if (canPersistVersions && remoteSnapshot && !remoteSnapshot.canEdit) return;
    if (recordUndo) {
      setUndoStack((stack) => [...stack, value].slice(-200));
      setRedoStack([]);
    }
    localEditRevisionRef.current += 1;
    setValue(next);
    setSaveState("unsaved");
  };

  const undo = () => {
    if (!undoStack.length) return;
    setRedoStack((stack) => [...stack, value]);
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    updateValue(previous, false);
    textareaRef.current?.focus();
  };
  const redo = () => {
    if (!redoStack.length) return;
    setUndoStack((stack) => [...stack, value]);
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    updateValue(next, false);
    textareaRef.current?.focus();
  };

  const exportActorRef = useRef(userKey);
  exportActorRef.current = userKey;
  useEffect(
    () => () => {
      autosaveGenerationRef.current += 1;
    },
    [],
  );
  const [exporting, setExporting] = useState(false);
  const exportOffice = async (format: "pdf" | "docx" | "xlsx" | "pptx") => {
    if (!open) return;
    const ticket = actionFeedback.begin("export");
    if (!ticket) return;
    const generation = autosaveGenerationRef.current;
    const actor = userKey;
    const current = () =>
      actionFeedback.current(ticket) &&
      generation === autosaveGenerationRef.current &&
      actor === exportActorRef.current;
    setExporting(true);
    try {
      const { downloadDocument } = await import("@/lib/writing-export/export");
      if (!current()) return;
      if (await downloadDocument(format, artifactTitle, value, current)) {
        if (!current()) return;
        actionFeedback.finish(ticket);
        toast.success("Document exported");
      } else actionFeedback.finish(ticket);
    } catch (error) {
      actionFeedback.finish(
        ticket,
        `Export could not be completed. ${error instanceof Error ? error.message : "Please try the same format again."} Your draft is preserved.`,
      );
    } finally {
      if (actionFeedback.scopeCurrent(ticket)) setExporting(false);
    }
  };
  useEffect(() => {
    setExporting(false);
    setServerExportOpen(false);
  }, [open, userKey, initialContent]);

  const exportDocument = () => {
    const ticket = actionFeedback.begin("export");
    if (!ticket) return;
    try {
      const extension = kind === "writing" ? "md" : kind === "website" ? "html" : "txt";
      downloadBytes(
        new TextEncoder().encode(value),
        "text/plain;charset=utf-8",
        safeDocumentFilename(artifactTitle, extension),
      );
      actionFeedback.finish(ticket);
    } catch (error) {
      actionFeedback.finish(
        ticket,
        `Download could not be started. ${error instanceof Error ? error.message : "Try Download again."} Your draft is preserved.`,
      );
    }
  };

  useEffect(() => {
    // Compare with the latest scheduled snapshot, not only the last completed
    // write. If edit A is in flight and the user reverts to the prior value,
    // that revert still needs to queue behind A.
    if (!open || value === lastScheduledValueRef.current) return;
    if (
      canPersistVersions &&
      (!collaboration.ready ||
        collaboration.conflict ||
        collaboration.error ||
        !remoteSnapshot?.canEdit)
    )
      return;
    let cancelled = false;
    const snapshot = value;
    const snapshotOrigin = editOriginRef.current;
    const editRevision = localEditRevisionRef.current;
    const generation = autosaveGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      lastScheduledValueRef.current = snapshot;
      setSaveState("saving");
      void (async () => {
        // Persist first, then label the entry honestly: only a resolved server
        // write may be shown as saved beyond this session.
        let durable = false;
        if (canPersistVersions && chatId && messageId) {
          try {
            // The queue orders this device's writes; the database CAS also
            // rejects an older snapshot from another editor or device.
            pendingAutosavesRef.current += 1;
            await autosaveQueueRef.current
              .enqueue(() => {
                if (autosaveGenerationRef.current !== generation)
                  throw new Error("This editing session changed.");
                return saveVersionFn(snapshot);
              })
              .finally(() => {
                pendingAutosavesRef.current -= 1;
              });
            // A later edit cancels this effect's UI work, but it does not
            // cancel an already-started server write. Preserve that successful
            // durable value for failure recovery within the same artifact.
            if (autosaveGenerationRef.current === generation) {
              lastRecordedValueRef.current = snapshot;
              setAcknowledgedEditRevision(editRevision);
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
              label: `${snapshotOrigin} · ${durable ? "saved to this result" : "session only"}`,
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
    collaboration.ready,
    collaboration.conflict,
    collaboration.error,
    remoteSnapshot?.canEdit,
  ]);

  if (!open) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  const save = async () => {
    if (!isSignedIn) {
      clerk?.openSignIn();
      return;
    }
    const ticket = actionFeedback.begin("save");
    if (!ticket) return;
    if (value.length > 200_000) {
      actionFeedback.finish(
        ticket,
        "This draft is too large for Library. Export it to download the complete file instead.",
      );
      return;
    }
    clearTimeout(savedTimerRef.current);
    setSaved(false);
    setSaving(true);
    try {
      const item_type =
        kind === "website" ? "website_draft" : kind === "code" ? "code" : "document";
      const title = artifactTitle;
      await saveFn({ data: { title, item_type, source: "chat", content_text: value } });
      if (!actionFeedback.current(ticket)) return;
      librarySavedValue.current = value;
      setSaved(true);
      actionFeedback.finish(ticket);
      toast.success("Saved to Library");
      savedTimerRef.current = setTimeout(() => {
        if (actionFeedback.scopeCurrent(ticket)) setSaved(false);
      }, 2000);
    } catch (error) {
      actionFeedback.finish(
        ticket,
        `Library save could not be confirmed. ${error instanceof Error ? error.message : "The service did not return a confirmed result."} Your result is preserved; the request may already have succeeded. Check Library before saving again.`,
      );
    } finally {
      if (actionFeedback.scopeCurrent(ticket)) setSaving(false);
    }
  };

  const improve = () => {
    if (canPersistVersions && !remoteSnapshot?.canEdit) return;
    const area = textareaRef.current;
    if (!area || area.selectionStart === area.selectionEnd) {
      toast.error("Select the passage you want to revise first.");
      return;
    }
    setRewriteTarget({ source: value, start: area.selectionStart, end: area.selectionEnd });
  };
  const editorBody = (
    <div
      ref={resultRootRef}
      className={`kova-result-editor ${embedded ? "kova-result-embedded" : ""}`}
      data-ui-reference="claude.artifacts.editor"
    >
      <div className="kova-result-surface">
        <header className="kova-result-heading">
          <div className="min-w-0">
            <h2
              ref={resultHeadingRef}
              tabIndex={-1}
              className="break-words text-base font-semibold"
            >
              {artifactTitle}
            </h2>
            <p className="text-xs text-muted-foreground">
              {projectId
                ? "Shared with Project members"
                : canPersistVersions
                  ? "Only you"
                  : "This session only"}
            </p>
          </div>
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            size="icon"
            variant="ghost"
            type="button"
            ref={resultCloseRef}
            onClick={(event) => requestClose(event.currentTarget)}
            className="kova-icon-button"
            aria-label="Close result"
          >
            <X className="h-5 w-5" />
          </Button>
        </header>
        <div
          className="kova-result-toolbar"
          data-ui-reference="claude.artifacts.toolbar"
          role="toolbar"
          aria-label="Result actions"
        >
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            variant="ghost"
            type="button"
            onClick={() => {
              setMode("edit");
              setSplitView(false);
            }}
            aria-pressed={mode === "edit"}
          >
            <Pencil />
            Edit
          </Button>
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            variant="ghost"
            type="button"
            onClick={(event) => {
              if (!historyActiveRef.current || historyScopeRef.current !== resultScope) return;
              if (historyOpen) {
                closeHistory();
                return;
              }
              historyReturnRef.current = {
                trigger: event.currentTarget,
                url: window.location.href,
                scope: resultScope,
                generation: autosaveGenerationRef.current,
              };
              historyVisibleRef.current = true;
              setHistoryOpen(true);
              setOutlineOpen(false);
              setCommentsOpen(false);
            }}
            aria-pressed={historyOpen}
          >
            <History />
            Versions
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-ui-reference="claude.artifacts.toolbar-button"
                variant="ghost"
                type="button"
                ref={exportTriggerRef}
                disabled={exporting}
              >
                <Download />
                {exporting ? "Exporting…" : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={exportDocument}>
                Download {kind === "writing" ? "Markdown" : kind === "website" ? "HTML" : "text"}
              </DropdownMenuItem>
              {kind === "writing" &&
                ["pdf", "docx", "xlsx", "pptx"].map((format) => (
                  <DropdownMenuItem
                    key={format}
                    onSelect={() => void exportOffice(format as "pdf" | "docx" | "xlsx" | "pptx")}
                  >
                    Download {format.toUpperCase()}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem
                onSelect={() => {
                  if (!open || !historyActiveRef.current || historyScopeRef.current !== resultScope)
                    return;
                  serverExportReturnRef.current = {
                    target: exportTriggerRef.current,
                    url: window.location.href,
                    scope: resultScope,
                    generation: autosaveGenerationRef.current,
                  };
                  setServerExportOpen(true);
                }}
              >
                Download via server…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            variant="ghost"
            type="button"
            onClick={() => setShareSnapshot(value)}
          >
            <Share2 />
            Share
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-ui-reference="claude.artifacts.toolbar-button"
                variant="ghost"
                type="button"
              >
                <MoreHorizontal />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {onResetLayout && (
                <DropdownMenuItem onSelect={onResetLayout}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset layout
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void copy(value)}>Copy result</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void save()} disabled={saving}>
                {saving ? (
                  <span className="spec400-loading-label">
                    <span className="spec400-loading-spinner" aria-hidden="true" />
                    Saving…
                  </span>
                ) : (
                  "Save to Library"
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={improve}>Rewrite selected passage</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setCommentsOpen((value) => !value);
                  setOutlineOpen(false);
                  setHistoryOpen(false);
                }}
              >
                Comments
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  openInWork(
                    { type: "artifact", id: kind, title: artifactTitle, content: value },
                    userKey,
                  )
                }
              >
                Open in Work
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="kova-result-secondary-toolbar">
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={undo}
            disabled={!undoStack.length}
            aria-label="Undo"
          >
            <Undo2 />
          </Button>
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={redo}
            disabled={!redoStack.length}
            aria-label="Redo"
          >
            <Redo2 />
          </Button>
          <Button
            data-ui-reference="claude.artifacts.toolbar-button"
            variant="ghost"
            type="button"
            onClick={() => {
              setOutlineOpen((value) => !value);
              setHistoryOpen(false);
              setCommentsOpen(false);
            }}
            aria-pressed={outlineOpen}
          >
            <ListTree />
            Outline
          </Button>
          {kind === "website" && (
            <Button
              data-ui-reference="claude.artifacts.toolbar-button"
              variant="ghost"
              type="button"
              onClick={() => {
                setMode("preview");
                setSplitView(false);
              }}
            >
              <Eye />
              Run preview
            </Button>
          )}
          <span role="status" className="ml-auto text-xs text-muted-foreground">
            {canPersistVersions && !collaboration.ready && !collaboration.error
              ? "Loading saved result…"
              : saveState === "saving"
                ? "Saving…"
                : saveState === "unsaved"
                  ? "Unsaved changes"
                  : saveState === "session_only"
                    ? "Session only"
                    : "Saved"}
          </span>
        </div>
        {Object.entries(actionFeedback.errors).length ? (
          <div
            className="max-h-40 shrink-0 overflow-y-auto border-b p-3 text-sm"
            aria-label="Result operation feedback"
          >
            {Object.entries(actionFeedback.errors).map(([action, message]) => (
              <div key={action} className="flex items-start gap-2">
                <p role="alert" className="min-w-0 flex-1 text-destructive">
                  {message}
                </p>
                <Button
                  variant="ghost"
                  type="button"
                  className="shrink-0"
                  aria-label={`Dismiss ${action} error`}
                  onClick={() => actionFeedback.clear(action)}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          {outlineOpen ? (
            <aside className="kova-result-inspector" aria-label="Document outline">
              <h2 className="mb-2 text-sm font-semibold">Outline</h2>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setOutlineOpen(false)}
                className="mb-2"
              >
                Close outline
              </Button>
              <label className="relative mb-2 block">
                <span className="sr-only">Search outline</span>
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={outlineQuery}
                  onChange={(event) => setOutlineQuery(event.target.value)}
                  className="w-full border bg-background pl-7 pr-2 text-xs"
                  placeholder="Find heading"
                />
              </label>
              {filteredOutline.length ? (
                filteredOutline.map((item) => (
                  <button
                    data-kova-button-shape="preserve"
                    data-ui-reference="claude.artifacts.outline-row"
                    key={`${item.line}-${item.label}`}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    style={{ paddingLeft: `${item.depth * 8}px` }}
                    onClick={() => {
                      setMode("edit");
                      setOutlineOpen(false);
                      const start =
                        value
                          .split("\n")
                          .slice(0, item.line - 1)
                          .join("\n").length + (item.line > 1 ? 1 : 0);
                      requestAnimationFrame(() => {
                        const area = textareaRef.current;
                        if (!area) return;
                        area.focus();
                        area.setSelectionRange(start, start);
                        area.scrollTop = Math.max(
                          0,
                          (item.line - 2) * parseFloat(getComputedStyle(area).lineHeight),
                        );
                      });
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
                <Textarea
                  ref={textareaRef}
                  readOnly={Boolean(
                    canPersistVersions && remoteSnapshot && !remoteSnapshot.canEdit,
                  )}
                  value={value}
                  onChange={(e) => updateValue(e.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      !event.altKey &&
                      event.key.toLowerCase() === "z"
                    ) {
                      event.preventDefault();
                      if (event.shiftKey) redo();
                      else undo();
                    } else if (
                      (event.ctrlKey || event.metaKey) &&
                      !event.altKey &&
                      event.key.toLowerCase() === "y"
                    ) {
                      event.preventDefault();
                      redo();
                    }
                  }}
                  spellCheck={!isCode}
                  className={`kova-result-textarea flex-1 w-full resize-none bg-background p-4 ${
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
          <Dialog
            open={historyOpen}
            onOpenChange={(next) => {
              if (!next) closeHistory();
            }}
          >
            <DialogContent
              className="spec400-library-inspector"
              aria-label="Version history"
              closeLabel="Close version history"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                const origin = historyReturnRef.current;
                if (
                  historyActiveRef.current &&
                  historyVisibleRef.current &&
                  origin?.scope === historyScopeRef.current &&
                  origin.generation === autosaveGenerationRef.current &&
                  window.location.href === origin.url
                )
                  historyHeadingRef.current?.focus({ preventScroll: true });
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const origin = historyReturnRef.current;
                historyReturnRef.current = null;
                const active = document.activeElement;
                const focusMoved =
                  active !== null &&
                  active !== document.body &&
                  active !== origin?.trigger &&
                  !(event.target instanceof HTMLElement && event.target.contains(active));
                restoreDialogFocus(
                  origin?.trigger,
                  origin?.url,
                  !historyActiveRef.current ||
                    focusMoved ||
                    origin?.scope !== historyScopeRef.current ||
                    origin?.generation !== autosaveGenerationRef.current,
                );
              }}
            >
              <header className="spec400-library-inspector-header shrink-0 border-b border-border">
                <div className="spec400-library-inspector-title">
                  <DialogTitle ref={historyHeadingRef} tabIndex={-1}>
                    Versions of {artifactTitle}
                  </DialogTitle>
                </div>
              </header>
              <div
                className="spec400-inspector-body flex-1"
                ref={(element) => {
                  if (element) element.scrollTop = historyScrollRef.current;
                }}
                onScroll={(event) => {
                  if (historyActiveRef.current && historyScopeRef.current === resultScope)
                    historyScrollRef.current = event.currentTarget.scrollTop;
                }}
              >
                <DialogDescription className="mb-3">
                  {canPersistVersions
                    ? "Confirmed edits stay with this result. Preview an earlier revision before restoring it as a new revision."
                    : "Versions are kept only while this result is open. Save to Library or export to keep your work."}
                </DialogDescription>
                {historyError || actionFeedback.errors.version ? (
                  <p role="alert" className="mb-3 text-xs text-destructive">
                    {historyError || actionFeedback.errors.version}
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
                      <Button
                        variant="ghost"
                        type="button"
                        className="mt-2 inline-flex items-center gap-2 text-sm font-medium"
                        onClick={async () => {
                          if (!historyVisibleRef.current) return;
                          const ticket = actionFeedback.begin("version");
                          if (
                            !ticket ||
                            !historyActiveRef.current ||
                            historyScopeRef.current !== resultScope
                          )
                            return;
                          historyPreviewTicketRef.current = ticket;
                          const request = ++historyRequestRef.current;
                          const generation = autosaveGenerationRef.current;
                          try {
                            const content = version.remoteRevision
                              ? await collaboration.versionContent(version.remoteRevision)
                              : version.content;
                            if (
                              autosaveGenerationRef.current !== generation ||
                              historyRequestRef.current !== request ||
                              !actionFeedback.current(ticket)
                            )
                              return;
                            actionFeedback.finish(ticket);
                            setVersions((current) =>
                              current.map((row) =>
                                row.id === version.id ? { ...row, content } : row,
                              ),
                            );
                            const origin = historyReturnRef.current;
                            compareReturnRef.current = origin
                              ? { ...origin, target: origin.trigger }
                              : null;
                            setCompareVersion(version.id);
                            closeHistory();
                          } catch (error) {
                            if (
                              autosaveGenerationRef.current !== generation ||
                              historyRequestRef.current !== request
                            )
                              return;
                            actionFeedback.finish(
                              ticket,
                              `Version could not be loaded. ${error instanceof Error ? error.message : "Try Preview version again."} Your current draft is preserved.`,
                            );
                          }
                        }}
                      >
                        <GitCompare className="h-3 w-3" /> Preview version
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {commentsOpen ? (
            <aside
              className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] w-full shrink-0 overflow-y-auto rounded-t-2xl border bg-[var(--surface-secondary)] p-3 shadow-xl md:static md:max-h-none md:w-72 md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none"
              aria-label="Artifact comments"
            >
              {canPersistVersions ? (
                remoteSnapshot ? (
                  <CanvasComments
                    key={JSON.stringify([userKey, remoteSnapshot.document.id])}
                    snapshot={remoteSnapshot}
                    value={value}
                    actorId={userKey}
                    dirty={value !== lastRecordedValueRef.current || collaboration.conflict}
                    onComment={(data) => collaboration.commentMutation("comment", data)}
                    onDelete={(commentId) =>
                      collaboration.commentMutation("delete_comment", { commentId })
                    }
                    onOlder={collaboration.olderComments}
                    selection={() => {
                      const area = textareaRef.current;
                      if (!area || area.selectionStart === area.selectionEnd) return null;
                      const start = Array.from(value.slice(0, area.selectionStart)).length;
                      const end = Math.min(
                        start + 500,
                        Array.from(value.slice(0, area.selectionEnd)).length,
                      );
                      return { start, end };
                    }}
                    onSelect={(start, end) => {
                      setMode("edit");
                      requestAnimationFrame(() => {
                        textareaRef.current?.focus();
                        textareaRef.current?.setSelectionRange(start, end);
                      });
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Comments are unavailable until this Canvas reconnects.
                  </p>
                )
              ) : (
                <>
                  <h2 ref={commentsHeadingRef} tabIndex={-1} className="text-sm font-semibold">
                    Comments
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Comments stay with this open editing session.
                  </p>
                  <label htmlFor={commentFieldId} className="mt-3 block text-sm font-medium">
                    Comment
                  </label>
                  <Textarea
                    ref={commentInputRef}
                    id={commentFieldId}
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    className="mt-3 min-h-20 w-full border bg-background text-xs"
                    placeholder="Comment on the document or current selection"
                    aria-label="Artifact comment"
                  />
                  <Button
                    variant="default"
                    disabled={!commentDraft.trim()}
                    onClick={() => {
                      if (!commentDraft.trim() || commentDraftRef.current !== commentDraft) return;
                      commentDraftRef.current = "";
                      commentInputRef.current?.focus({ preventScroll: true });
                      const area = textareaRef.current;
                      const selection = area
                        ? value.slice(area.selectionStart, area.selectionEnd)
                        : "";
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
                    className="mt-2 bg-foreground text-xs text-background disabled:opacity-50"
                  >
                    Add comment
                  </Button>
                  {comments.length === 0 ? (
                    <p className="mt-4 text-xs text-muted-foreground">No comments yet.</p>
                  ) : (
                    <ul className="mt-4 space-y-2">
                      {comments.map((comment) => (
                        <li
                          key={comment.id}
                          className="rounded-lg border bg-background p-2 text-xs"
                        >
                          {comment.selection && (
                            <blockquote className="mb-2 border-l-2 pl-2 text-muted-foreground">
                              {comment.selection}
                            </blockquote>
                          )}
                          <p>{comment.body}</p>
                          <Button
                            variant="ghost"
                            onClick={(event) =>
                              setDeleteCommentTarget({
                                id: comment.id,
                                body: comment.body,
                                scope: resultScope,
                                trigger: event.currentTarget,
                                url: window.location.href,
                              })
                            }
                            className="mt-2 text-destructive"
                          >
                            Delete comment
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </aside>
          ) : null}
        </div>

        {canPersistVersions && (collaboration.conflict || collaboration.error) && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 border-t border-amber-400/40 bg-amber-400/10 p-3 text-sm"
          >
            <span>
              {collaboration.conflict
                ? "Another editor saved changes. Your draft is preserved; copy it before loading the current version."
                : collaboration.error}
            </span>
            <Button variant="outline" className="border" onClick={() => void copy(value)}>
              Copy my draft
            </Button>
            {collaboration.conflict ? (
              <Button
                variant="outline"
                className="border"
                onClick={(event) => {
                  const content = collaboration.adopt();
                  if (content !== null) {
                    // The recovery control disappears after adoption. Hand focus to a
                    // surviving Result target now, without scheduling a later focus steal.
                    restoreResultFocus(
                      {
                        target: null,
                        url: window.location.href,
                        scope: resultScope,
                        generation: autosaveGenerationRef.current,
                      },
                      event.currentTarget,
                    );
                    autosaveGenerationRef.current += 1;
                    localEditRevisionRef.current = 0;
                    setAcknowledgedEditRevision(0);
                    lastRecordedValueRef.current = content;
                    lastScheduledValueRef.current = content;
                    setValue(content);
                    setSaveState("saved");
                  }
                }}
              >
                Load current version
              </Button>
            ) : (
              <Button variant="outline" className="border" onClick={collaboration.retry}>
                Reconnect
              </Button>
            )}
          </div>
        )}

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
              <Button
                variant="ghost"
                type="button"
                onClick={(event) => {
                  if (
                    !compareOrigin ||
                    compareReturnRef.current !== compareOrigin ||
                    !resultFocusIsCurrent(compareOrigin)
                  )
                    return;
                  // Transfer focus before removing the focused preview control; no delayed work
                  // can steal focus from a later interaction or a replacement Result.
                  restoreResultFocus(compareOrigin, event.currentTarget);
                  compareReturnRef.current = null;
                  setCompareVersion(null);
                }}
                className="text-xs hover:bg-accent"
              >
                Close preview
              </Button>
              <Button
                variant="outline"
                type="button"
                className="border text-sm"
                disabled={canPersistVersions && !remoteSnapshot?.canEdit}
                onClick={() => {
                  const version = versions.find((item) => item.id === compareVersion);
                  if (!version) return;
                  updateValue(version.content);
                  compareReturnRef.current = null;
                  setCompareVersion(null);
                  toast.message(
                    canPersistVersions
                      ? "Earlier version loaded. Saving it as a new revision…"
                      : "Earlier version loaded into this session. Save to Library or export to keep it.",
                  );
                }}
              >
                Restore this version
              </Button>
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

        {copyError && (
          <div role="alert" className="border-t p-3 text-sm">
            Couldn’t copy.{" "}
            <Button
              variant="link"
              type="button"
              className="underline"
              onClick={() => {
                setMode("edit");
                requestAnimationFrame(() => {
                  textareaRef.current?.focus();
                  textareaRef.current?.select();
                });
              }}
            >
              Select the result to copy manually
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t p-3 text-xs text-muted-foreground">
          <span>
            {statistics.words.toLocaleString()} words · {statistics.lines.toLocaleString()} lines
          </span>
          {saved && <span role="status">Saved to Library</span>}
          {copied && <span role="status">Copied</span>}
          {canPersistVersions && <CollaborationStatus {...collaboration.presence} />}
        </div>
      </div>
    </div>
  );
  return (
    <>
      {embedded ? (
        editorBody
      ) : (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) requestClose();
          }}
        >
          <DialogContent className="kova-result-dialog" aria-describedby={undefined}>
            <DialogTitle className="sr-only">{artifactTitle}</DialogTitle>
            {editorBody}
          </DialogContent>
        </Dialog>
      )}
      <ResultCommentDeleteDialog
        target={deleteCommentTarget}
        scope={resultScope}
        durable={false}
        fallbackRef={commentsHeadingRef}
        onClose={() => setDeleteCommentTarget(null)}
        onDelete={(id) => {
          setComments((current) => current.filter((comment) => comment.id !== id));
        }}
      />
      {rewriteTarget && (
        <SelectionEditDialog
          open
          onOpenChange={(next) => {
            if (!next) setRewriteTarget(null);
          }}
          target={rewriteTarget}
          onApply={(next, origin) =>
            updateValue(next, true, origin === "ai" ? "AI revision" : "User edit")
          }
        />
      )}
      {shareSnapshot !== null && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setShareSnapshot(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share result snapshot</DialogTitle>
              <DialogDescription>
                Only the text below is included. Later edits, chat history, attachments, and private
                metadata are excluded.
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm">
              {shareSnapshot}
            </pre>
            <Button
              variant="outline"
              type="button"
              className="border"
              onClick={async () => {
                try {
                  if (navigator.share)
                    await navigator.share({ title: artifactTitle, text: shareSnapshot });
                  else {
                    await navigator.clipboard.writeText(shareSnapshot);
                    toast.success("Snapshot copied");
                  }
                  setShareSnapshot(null);
                } catch (error) {
                  if (!(error instanceof Error && error.name === "AbortError"))
                    toast.error("Couldn’t share. Your result is preserved.");
                }
              }}
            >
              {typeof navigator !== "undefined" && typeof navigator.share === "function"
                ? "Share this snapshot"
                : "Copy this snapshot"}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {open && serverExportOpen && (
        <ResultServerExportDialog
          key={resultScope}
          title={artifactTitle}
          content={value}
          kind={kind}
          isCurrent={() =>
            serverExportReturnRef.current === serverExportOrigin &&
            resultFocusIsCurrent(serverExportOrigin)
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!serverExportOrigin || serverExportReturnRef.current !== serverExportOrigin) return;
            serverExportReturnRef.current = null;
            restoreResultFocus(serverExportOrigin, event.target);
          }}
          onClose={() => {
            if (serverExportReturnRef.current === serverExportOrigin) setServerExportOpen(false);
          }}
        />
      )}
      <Dialog
        open={closeReview}
        onOpenChange={(next) => {
          if (closeReviewReturnRef.current === closeReviewOrigin) setCloseReview(next);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (
              closeReviewReturnRef.current === closeReviewOrigin &&
              resultFocusIsCurrent(closeReviewOrigin)
            )
              keepEditingRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = closeReviewOrigin;
            if (!origin || closeReviewReturnRef.current !== origin) return;
            closeReviewReturnRef.current = null;
            if (!resultFocusIsCurrent(origin) || !resultOwnsFocus(origin, event.target)) return;
            if (origin.discard) onClose();
            else restoreResultFocus(origin, event.target);
          }}
        >
          <DialogHeader>
            <DialogTitle>Keep your result before closing?</DialogTitle>
            <DialogDescription>
              {saveState === "saving"
                ? "Saving is still in progress. Keep editing until it completes, or download your current draft."
                : "Your latest changes are not confirmed saved beyond this session. Download them or keep editing before closing."}
            </DialogDescription>
          </DialogHeader>
          {actionFeedback.errors.export ? (
            <p role="alert" className="text-sm text-destructive">
              {actionFeedback.errors.export}
            </p>
          ) : null}
          <Button variant="outline" type="button" className="border" onClick={exportDocument}>
            Download current draft
          </Button>
          <Button
            variant="outline"
            type="button"
            ref={keepEditingRef}
            className="border"
            onClick={() => {
              if (closeReviewReturnRef.current === closeReviewOrigin) setCloseReview(false);
            }}
          >
            Keep editing
          </Button>
          <Button
            variant="outline"
            type="button"
            className="border"
            onClick={() => {
              if (
                closeReviewOrigin &&
                closeReviewReturnRef.current === closeReviewOrigin &&
                resultFocusIsCurrent(closeReviewOrigin)
              ) {
                closeReviewOrigin.discard = true;
                setCloseReview(false);
              }
            }}
          >
            Close without keeping changes
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
