import { ArtifactHistoryPanel } from "./ArtifactHistoryPanel";
import { artifactHistoryStatus } from "@/lib/artifact-history-status";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { ArtifactEditorSurface } from "./ArtifactEditorSurface";
import { DocumentPaper } from "./DocumentPaper";
import { printDocumentPaper } from "@/lib/print-document";
import { useDeviceRecord } from "@/lib/use-device-record";
import { DeviceRecoveryStatus } from "./DeviceRecoveryStatus";
import {
  EMPTY_DOCUMENT_TITLE,
  isDocumentTitle,
  formatDocumentSelection,
} from "@/lib/document-formatting.mjs";
import { safeDocumentFilename, OFFICE_EXPORT_NOTES } from "@/lib/writing-export/common";
import { Link, useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { addToContextPack, continueInChat, openInWork } from "@/lib/workspace-handoffs";
import { CollaborationStatus } from "@/components/CollaborationStatus";
import { CanvasComments } from "@/components/CanvasComments";
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

type ArtifactEditorProps = {
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
  documentId?: string;
  presentation?: "dialog" | "page";
};
export function ArtifactEditor(props: ArtifactEditorProps) {
  const { user } = useUser();
  if (!props.open) return null;
  return (
    <ArtifactEditorSession
      key={JSON.stringify([
        user?.id,
        props.chatId,
        props.messageId,
        props.projectId,
        props.documentId,
      ])}
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
  documentId,
  presentation = "dialog",
}: ArtifactEditorProps) {
  const [value, setValue] = useState(initialContent);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">(initialMode);
  const [splitView, setSplitView] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const outlineUrlRef = useRef<string | undefined>(undefined);
  const closeOutline = useCallback(() => {
    setOutlineOpen(false);
    restoreDialogFocus(outlineTriggerRef.current, outlineUrlRef.current);
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyUrlRef = useRef<string | undefined>(undefined);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    restoreDialogFocus(historyTriggerRef.current, historyUrlRef.current);
  }, []);
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
  const librarySavePendingRef = useRef(false);
  const librarySaveAttemptRef = useRef<{
    generation: number;
    actor: string;
    content: string;
    kind: ArtifactKind;
    title: string;
    idempotencyKey: string;
  } | null>(null);
  const localEditRevisionRef = useRef(0);
  const [acknowledgedEditRevision, setAcknowledgedEditRevision] = useState(0);
  const pendingAutosavesRef = useRef(0);
  const autosaveQueueRef = useRef(createSerializedWriteQueue());
  const [autosaveRetryNonce, setAutosaveRetryNonce] = useState(0);
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
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
    documentId,
  });
  const saveVersionFn = collaboration.save;
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [titleTarget] = useState(
    () =>
      documentId || JSON.stringify([chatId || "session", messageId || crypto.randomUUID(), kind]),
  );
  const titleRecovery = useDeviceRecord(
    "kova-document-titles",
    isLoaded ? userKey : undefined,
    titleTarget,
    EMPTY_DOCUMENT_TITLE,
    isDocumentTitle,
    false,
  );
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState("");
  const titleInitialized = useRef(false);
  const titlePendingRef = useRef(false);
  const titleRequestRef = useRef(0);
  const titleAttemptRef = useRef<{ title: string; id: string } | null>(null);
  const accountTitle = collaboration.snapshot?.document.title;
  const titleAccountDirty =
    canPersistVersions &&
    titleRecovery.loaded &&
    accountTitle !== undefined &&
    titleRecovery.value.title !== accountTitle;
  useEffect(() => {
    if (titleInitialized.current || !titleRecovery.loaded || accountTitle === undefined) return;
    titleInitialized.current = true;
    if (!titleRecovery.stored && !titleRecovery.dirty)
      titleRecovery.setValue({ title: accountTitle });
  }, [accountTitle, titleRecovery]);
  const saveAccountTitle = async () => {
    if (
      titlePendingRef.current ||
      !collaboration.snapshot?.canEdit ||
      accountTitle === undefined ||
      collaboration.conflict
    )
      return;
    const capturedTitle = titleRecovery.value.title,
      generation = autosaveGenerationRef.current;
    if (titleAttemptRef.current?.title !== capturedTitle)
      titleAttemptRef.current = { title: capturedTitle, id: crypto.randomUUID() };
    const mutationId = titleAttemptRef.current.id;
    const requestId = ++titleRequestRef.current;
    const current = () =>
      autosaveGenerationRef.current === generation && titleRequestRef.current === requestId;
    titlePendingRef.current = true;
    setTitleSaving(true);
    setTitleError("");
    try {
      await autosaveQueueRef.current.enqueue(() => {
        if (!current()) throw new Error("This editing session changed.");
        return collaboration.saveTitle(capturedTitle, mutationId);
      });
      if (current()) titleAttemptRef.current = null;
    } catch (e) {
      if (current())
        setTitleError(
          e instanceof Error ? e.message : "Account title save failed; device draft retained.",
        );
    } finally {
      if (current()) {
        titlePendingRef.current = false;
        setTitleSaving(false);
      }
    }
  };
  const [paper, setPaper] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const printCleanupRef = useRef<(() => void) | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [formatUndo, setFormatUndo] = useState<{ before: string; after: string } | null>(null);
  const [formatRedo, setFormatRedo] = useState<{ before: string; after: string } | null>(null);
  const artifactTitle =
    titleRecovery.value.title.trim() ||
    (kind === "code"
      ? "Code artifact"
      : kind === "website"
        ? "Website artifact"
        : "Writing artifact");

  useEffect(() => setSaved(false), [artifactTitle]);
  const currentDraftRef = useRef({
    title: artifactTitle,
    body: value,
    recoveryEpoch: titleRecovery.epoch,
  });
  currentDraftRef.current = {
    title: artifactTitle,
    body: value,
    recoveryEpoch: titleRecovery.epoch,
  };
  const preview = useMemo(
    () => (kind === "website" ? buildPreviewDoc(value) : { doc: "", hadScripts: false }),
    [kind, value],
  );

  useEffect(() => {
    printCleanupRef.current?.();
    // Opening, closing, or replacing an artifact invalidates all asynchronous
    // work captured by the previous Canvas session.
    autosaveGenerationRef.current += 1;
    librarySavePendingRef.current = false;
    librarySaveAttemptRef.current = null;
    titleRequestRef.current += 1;
    titlePendingRef.current = false;
    titleAttemptRef.current = null;
    setTitleSaving(false);
    setTitleError("");
    setSaving(false);
    if (open) {
      localEditRevisionRef.current = 0;
      setAcknowledgedEditRevision(0);
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
      setComments([]);
      setCommentDraft("");
      setCommentsOpen(false);
    }
    return () => {
      autosaveGenerationRef.current += 1;
    };
  }, [open, initialContent, initialMode, kind, userKey, chatId, messageId, projectId]);

  // Canonical snapshots never replace a dirty local edit. Version content is
  // fetched only on restore/compare, keeping realtime refreshes bounded.
  const remoteSnapshot = collaboration.snapshot;
  const historyStatus = artifactHistoryStatus({
    canPersist: canPersistVersions,
    ready: collaboration.ready,
    hasSavedVersions: versions.some((version) => version.durable),
    currentAcknowledged: Boolean(remoteSnapshot && remoteSnapshot.document.content === value),
    saveState,
    failed: Boolean(historyError || collaboration.error),
    conflict: Boolean(collaboration.conflict),
  });
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
      pendingAutosavesRef.current === 0 &&
      !titleAccountDirty &&
      !titleSaving
    ) {
      const content = adoptRemote();
      if (content !== null) {
        lastRecordedValueRef.current = content;
        lastScheduledValueRef.current = content;
        setValue(content);
        setSaveState("saved");
      }
    }
  }, [
    open,
    remoteSnapshot,
    adoptRemote,
    value,
    acknowledgedEditRevision,
    titleAccountDirty,
    titleSaving,
  ]);

  const hasUnsavedDraft =
    titleRecovery.dirty ||
    titleAccountDirty ||
    titleSaving ||
    value !== lastRecordedValueRef.current ||
    saveState === "unsaved" ||
    saveState === "saving" ||
    (!canPersistVersions && value !== initialContent);
  const approveClose = useCallback(
    () =>
      !hasUnsavedDraft ||
      window.confirm(
        "Leave this document draft? Export the current draft first if it has not been saved. Pending saves may still finish.",
      ),
    [hasUnsavedDraft],
  );
  const requestClose = useCallback(() => {
    if (approveClose()) onClose();
  }, [approveClose, onClose]);
  useBlocker({ shouldBlockFn: () => !approveClose(), enableBeforeUnload: hasUnsavedDraft });
  useEffect(() => {
    if (!open || presentation !== "page") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (outlineOpen) closeOutline();
        else if (historyOpen) closeHistory();
        else requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, presentation, requestClose, outlineOpen, closeOutline, historyOpen, closeHistory]);

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
    if (canPersistVersions && remoteSnapshot && !remoteSnapshot.canEdit) return;
    localEditRevisionRef.current += 1;
    setValue(next);
    setSaved(false);
    setSaveState("unsaved");
  };

  const exportActorRef = useRef(userKey);
  exportActorRef.current = userKey;
  useEffect(
    () => () => {
      autosaveGenerationRef.current += 1;
      printCleanupRef.current?.();
    },
    [],
  );
  const [exportFormat, setExportFormat] = useState<"source" | "pdf" | "docx" | "xlsx" | "pptx">(
    "source",
  );
  const [exporting, setExporting] = useState(false);
  const exportOffice = async () => {
    if (!open || exporting || exportFormat === "source") return;
    const generation = autosaveGenerationRef.current;
    const actor = userKey;
    const current = () =>
      generation === autosaveGenerationRef.current && actor === exportActorRef.current;
    const exportSnapshot = {
      title: artifactTitle,
      body: textareaRef.current?.value ?? value,
      format: exportFormat,
    };
    setExporting(true);
    try {
      const { downloadDocument } = await import("@/lib/writing-export/export");
      if (
        current() &&
        (await downloadDocument(
          exportSnapshot.format,
          exportSnapshot.title,
          exportSnapshot.body,
          current,
        ))
      )
        toast.success("Document exported");
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : "Document export failed");
    } finally {
      if (current()) setExporting(false);
    }
  };
  useEffect(() => {
    setExporting(false);
  }, [open, userKey, initialContent]);

  const exportDocument = () => {
    const extension = kind === "writing" ? "md" : kind === "website" ? "html" : "txt";
    const body = textareaRef.current?.value ?? value;
    const content = kind === "writing" ? `# ${artifactTitle}\n\n${body}` : body;
    const blob = new Blob([content], {
      type:
        kind === "writing"
          ? "text/markdown;charset=utf-8"
          : kind === "website"
            ? "text/html;charset=utf-8"
            : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeDocumentFilename(artifactTitle, extension);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const formatSelection = (action: string) => {
    if (canPersistVersions && !remoteSnapshot?.canEdit) return;
    const area = textareaRef.current;
    if (!area) return;
    const before = area.value;
    const url = action === "link" ? window.prompt("Link address (https://…)") : "";
    if (url === null) return;
    try {
      const result = formatDocumentSelection(
        before,
        selectionRef.current.start,
        selectionRef.current.end,
        action,
        url,
      );
      updateValue(result.text);
      setFormatUndo({ before, after: result.text });
      setFormatRedo(null);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(result.start, result.end);
        selectionRef.current = { start: result.start, end: result.end };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Formatting failed");
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
    collaboration.ready,
    collaboration.conflict,
    collaboration.error,
    remoteSnapshot?.canEdit,
  ]);

  if (!open) return null;

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    if (!isSignedIn || !userKey) {
      clerk?.openSignIn();
      return;
    }
    if (librarySavePendingRef.current || exportActorRef.current !== userKey) return;
    if (value.length > 200_000) {
      toast.error(
        "This draft is too large for Library. Export it to download the complete file instead.",
      );
      return;
    }
    const generation = autosaveGenerationRef.current;
    const revision = localEditRevisionRef.current;
    const recoveryEpoch = currentDraftRef.current.recoveryEpoch;
    const actor = userKey;
    const current = () =>
      generation === autosaveGenerationRef.current && actor === exportActorRef.current;
    const previous = librarySaveAttemptRef.current;
    const attempt =
      previous?.generation === generation &&
      previous.actor === actor &&
      previous.content === value &&
      previous.kind === kind &&
      previous.title === artifactTitle
        ? previous
        : {
            generation,
            actor,
            content: value,
            kind,
            title: artifactTitle,
            idempotencyKey: crypto.randomUUID(),
          };
    librarySaveAttemptRef.current = attempt;
    librarySavePendingRef.current = true;
    setSaving(true);
    try {
      const item_type =
        kind === "website" ? "website_draft" : kind === "code" ? "code" : "document";
      const title = artifactTitle;
      await saveFn({
        data: {
          expectedOwnerId: actor,
          idempotencyKey: attempt.idempotencyKey,
          title,
          item_type,
          source: "chat",
          content_text: value,
        },
      });
      if (!current()) return;
      setSaved(
        localEditRevisionRef.current === revision &&
          currentDraftRef.current.title === title &&
          currentDraftRef.current.body === value &&
          currentDraftRef.current.recoveryEpoch === recoveryEpoch,
      );
      toast.success("Saved to Library");
      setTimeout(() => {
        if (current()) setSaved(false);
      }, 2000);
    } catch (e) {
      if (current()) toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      if (current()) {
        librarySavePendingRef.current = false;
        setSaving(false);
      }
    }
  };

  const improve = () => {
    if (!onImprove || (canPersistVersions && !remoteSnapshot?.canEdit)) return;
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
    if (!approveClose()) return;
    onImprove(prompt);
    onClose();
  };

  return (
    <ArtifactEditorSurface
      presentation={presentation}
      label={label}
      onRequestClose={requestClose}
      onEscape={outlineOpen ? closeOutline : historyOpen ? closeHistory : undefined}
    >
      {kind === "writing" && (
        <section
          className="shrink-0 space-y-2 border-b p-3"
          aria-label="Document title and formatting"
        >
          <label className="block text-sm">
            Current document title
            <input
              maxLength={200}
              value={titleRecovery.value.title}
              placeholder="Writing artifact"
              disabled={
                !titleRecovery.loaded || (canPersistVersions && !collaboration.snapshot?.canEdit)
              }
              onChange={(event) => {
                titleRecovery.setValue({ title: event.target.value });
                setSaved(false);
              }}
              className="mt-1 min-h-11 w-full rounded-xl border bg-background px-3 text-base"
            />
          </label>
          <DeviceRecoveryStatus {...titleRecovery} />
          {exportFormat !== "source" && (
            <p className="text-xs text-muted-foreground">{OFFICE_EXPORT_NOTES[exportFormat]}</p>
          )}
          {canPersistVersions && (
            <div className="space-y-2">
              <p role="status">
                {titleSaving
                  ? "Saving account title…"
                  : accountTitle === undefined
                    ? "Account title storage unavailable until the title contract is installed."
                    : titleAccountDirty
                      ? "Current title differs from the account version."
                      : "Title matches the account version."}
              </p>
              {titleError && <p role="alert">{titleError}</p>}
              <button
                type="button"
                disabled={
                  titleSaving ||
                  accountTitle === undefined ||
                  !remoteSnapshot?.canEdit ||
                  collaboration.conflict
                }
                onClick={() => void saveAccountTitle()}
                className="min-h-11 rounded-xl border px-3"
              >
                Save current title to account
              </button>
              <button
                type="button"
                disabled={titleSaving || accountTitle === undefined}
                onClick={() => {
                  if (
                    accountTitle !== undefined &&
                    window.confirm("Replace the device title with the account title?")
                  )
                    titleRecovery.setValue({ title: accountTitle });
                }}
                className="min-h-11 rounded-xl border px-3"
              >
                Use account title
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Library saves and exports include the current draft title. Device recovery and the
            shared Canvas title are saved separately; Canvas title changes use its edit permissions
            and revision checks.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              "bold",
              "italic",
              "heading",
              "bullet",
              "numbered",
              "quote",
              "indent",
              "outdent",
              "link",
            ].map((action) => (
              <button
                key={action}
                type="button"
                disabled={paper || (canPersistVersions && !remoteSnapshot?.canEdit)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => formatSelection(action)}
                className="min-h-11 rounded-xl border px-3 text-sm capitalize"
              >
                {action}
              </button>
            ))}
            <button
              type="button"
              className="min-h-11 rounded-xl border px-3"
              disabled={!formatUndo || (canPersistVersions && !remoteSnapshot?.canEdit)}
              onClick={() => {
                if (!formatUndo) return;
                if (value !== formatUndo.after) {
                  toast.error("The draft changed after formatting. Your newer text was preserved.");
                  return;
                }
                updateValue(formatUndo.before);
                setFormatRedo(formatUndo);
                setFormatUndo(null);
              }}
            >
              Undo formatting
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border px-3"
              disabled={!formatRedo || (canPersistVersions && !remoteSnapshot?.canEdit)}
              onClick={() => {
                if (!formatRedo) return;
                if (value !== formatRedo.before) {
                  toast.error("The draft changed. Your newer text was preserved.");
                  return;
                }
                updateValue(formatRedo.after);
                setFormatUndo(formatRedo);
                setFormatRedo(null);
              }}
            >
              Redo formatting
            </button>
            <button
              type="button"
              aria-pressed={paper}
              className="min-h-11 rounded-xl border px-3"
              onClick={() => {
                setPaper(!paper);
                if (paper)
                  requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                    textareaRef.current?.setSelectionRange(
                      selectionRef.current.start,
                      selectionRef.current.end,
                    );
                  });
              }}
            >
              {paper ? "Edit source" : "Paper view"}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border px-3"
              disabled={value.length > 200000}
              onClick={() => {
                printCleanupRef.current?.();
                if (paperRef.current)
                  printCleanupRef.current = printDocumentPaper(paperRef.current);
              }}
            >
              Print current draft
            </button>
          </div>
        </section>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <CollaborationStatus {...collaboration.presence} />
          <span className="text-[11px] text-muted-foreground">
            {projectId
              ? "Shared with Project members"
              : canPersistVersions
                ? "Only you"
                : "This session only"}
          </span>
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
            {historyStatus.label}
          </span>
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {statistics.words.toLocaleString()} words · {statistics.readingMinutes} min read ·{" "}
            {statistics.lines.toLocaleString()} lines
          </span>
        </div>
        <div className="flex items-center gap-1">
          {presentation === "dialog" &&
            !projectId &&
            chatId &&
            remoteSnapshot &&
            saveState === "saved" &&
            remoteSnapshot.document.content === value &&
            pendingAutosavesRef.current === 0 &&
            !titleAccountDirty &&
            !titleSaving && (
              <Link
                to="/c/$conversationId/canvas/$documentId"
                params={{ conversationId: chatId, documentId: remoteSnapshot.document.id }}
                search={{ kind }}
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs hover:bg-accent"
              >
                Open page
              </Link>
            )}
          <button
            ref={outlineTriggerRef}
            onClick={() => {
              if (outlineOpen) closeOutline();
              else {
                outlineUrlRef.current = window.location.href;
                setOutlineOpen(true);
              }
            }}
            className="kova-icon-button"
            aria-label="Toggle document outline"
            aria-pressed={outlineOpen}
            aria-expanded={outlineOpen}
          >
            <ListTree className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (!commentsOpen) setHistoryOpen(false);
              setCommentsOpen((v) => !v);
            }}
            className="kova-icon-button"
            aria-label="Toggle artifact comments"
            aria-pressed={commentsOpen}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            ref={historyTriggerRef}
            onClick={() => {
              if (historyOpen) closeHistory();
              else {
                historyUrlRef.current = window.location.href;
                setCommentsOpen(false);
                setHistoryOpen(true);
              }
            }}
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
          <button onClick={requestClose} className="kova-icon-button" aria-label="Close editor">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        className={`flex min-h-80 flex-col ${outlineOpen ? "flex-[1_0_auto]" : "flex-[1_0_20rem]"} md:min-h-0 md:flex-1 md:flex-row`}
      >
        {outlineOpen ? (
          <aside
            className="max-h-60 w-full shrink-0 overflow-y-auto border-b border-border p-3 md:max-h-none md:w-56 md:border-b-0 md:border-r"
            aria-label="Document outline"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outline
              </h2>
              <button
                type="button"
                onClick={closeOutline}
                className="kova-icon-button shrink-0"
                aria-label="Close document outline"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="relative mb-2 block">
              <span className="sr-only">Search outline</span>
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={outlineQuery}
                onChange={(event) => setOutlineQuery(event.target.value)}
                className="min-h-11 w-full rounded-lg border bg-background pl-7 pr-2 text-xs md:min-h-8"
                placeholder="Find heading"
              />
            </label>
            {filteredOutline.length ? (
              filteredOutline.map((item) => (
                <button
                  key={`${item.line}-${item.label}`}
                  className="block min-h-11 w-full rounded px-2 py-1.5 text-left text-xs [overflow-wrap:anywhere] hover:bg-accent md:min-h-0 md:truncate"
                  style={{ paddingLeft: `${item.depth * 8}px` }}
                  onClick={() => {
                    if (kind === "writing" && paper) {
                      const heading = paperRef.current?.querySelector<HTMLElement>(
                        `[data-document-line="${item.line}"]`,
                      );
                      if (heading) {
                        heading.focus({ preventScroll: true });
                        heading.scrollIntoView({ block: "start" });
                      }
                      return;
                    }
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
        <div
          className={`min-h-0 min-w-0 ${outlineOpen ? "h-80 flex-none md:h-auto md:flex-1" : "flex-1"} ${splitView ? "grid md:grid-cols-2" : "flex flex-col"}`}
        >
          {kind === "writing" && (
            <DocumentPaper
              containerRef={paperRef}
              title={artifactTitle}
              content={value}
              visible={paper}
            />
          )}
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
            <div
              hidden={kind === "writing" && paper}
              className={`min-h-0 flex-1 flex-col ${kind === "writing" && paper ? "hidden" : "flex"}`}
            >
              <textarea
                ref={textareaRef}
                hidden={kind === "writing" && paper}
                onSelect={(event) => {
                  selectionRef.current = {
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  };
                }}
                readOnly={Boolean(canPersistVersions && remoteSnapshot && !remoteSnapshot.canEdit)}
                value={value}
                onChange={(e) => updateValue(e.target.value)}
                spellCheck={!isCode}
                className={`min-h-0 flex-1 w-full resize-none bg-background outline-none p-4 text-sm leading-relaxed ${
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
          <ArtifactHistoryPanel summary={historyStatus.summary} onClose={closeHistory}>
            {historyError ? (
              <p role="alert" className="mb-3 text-xs text-destructive">
                {historyError}
              </p>
            ) : null}
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.id} className="rounded-lg border border-border bg-background p-2">
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
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50"
                    disabled={canPersistVersions && !remoteSnapshot?.canEdit}
                    onClick={async () => {
                      const generation = autosaveGenerationRef.current;
                      try {
                        const content = version.remoteRevision
                          ? await collaboration.versionContent(version.remoteRevision)
                          : version.content;
                        if (autosaveGenerationRef.current !== generation) return;
                        updateValue(content);
                        toast.success("Version restored");
                      } catch (error) {
                        if (autosaveGenerationRef.current !== generation) return;
                        toast.error(
                          error instanceof Error ? error.message : "Version could not be loaded.",
                        );
                      }
                    }}
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                  <button
                    className="ml-3 mt-2 inline-flex items-center gap-1 text-xs font-medium"
                    onClick={async () => {
                      const generation = autosaveGenerationRef.current;
                      try {
                        const content = version.remoteRevision
                          ? await collaboration.versionContent(version.remoteRevision)
                          : version.content;
                        if (autosaveGenerationRef.current !== generation) return;
                        setVersions((current) =>
                          current.map((row) => (row.id === version.id ? { ...row, content } : row)),
                        );
                        setCompareVersion(version.id);
                      } catch (error) {
                        if (autosaveGenerationRef.current !== generation) return;
                        toast.error(
                          error instanceof Error ? error.message : "Version could not be loaded.",
                        );
                      }
                    }}
                  >
                    <GitCompare className="h-3 w-3" /> Compare
                  </button>
                </div>
              ))}
            </div>
          </ArtifactHistoryPanel>
        ) : null}
        {commentsOpen ? (
          <aside
            className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] w-full shrink-0 overflow-y-auto rounded-t-2xl border bg-[var(--surface-secondary)] p-3 shadow-xl md:static md:max-h-none md:w-72 md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none"
            aria-label="Artifact comments"
          >
            {canPersistVersions ? (
              remoteSnapshot ? (
                <CanvasComments
                  key={remoteSnapshot.document.id}
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
                  className="kova-workspace-action mt-2 min-h-9 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"
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
              </>
            )}
          </aside>
        ) : null}
      </div>

      {canPersistVersions && (collaboration.conflict || collaboration.error) && (
        <div
          role="alert"
          className="kova-artifact-recovery flex shrink-0 flex-wrap items-center gap-3 border-t border-amber-400/40 bg-amber-400/10 p-3 text-sm max-md:max-h-none! max-md:overflow-visible!"
        >
          <span>
            {collaboration.conflict
              ? "Another editor saved changes. Your draft is preserved; copy it before loading the current version."
              : collaboration.error}
          </span>
          <button className="min-h-9 rounded-lg border px-3" onClick={() => void copy(value)}>
            Copy my draft
          </button>
          {collaboration.conflict ? (
            <button
              className="min-h-9 rounded-lg border px-3"
              onClick={() => {
                const content = collaboration.adopt();
                if (content !== null) {
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
            </button>
          ) : (
            <button className="min-h-9 rounded-lg border px-3" onClick={collaboration.retry}>
              Reconnect
            </button>
          )}
        </div>
      )}

      {compareVersion && versions.find((version) => version.id === compareVersion) ? (
        <div
          className="max-h-[38vh] shrink-0 overflow-auto border-t bg-muted/30 p-3"
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

      <div className="kova-artifact-footer flex shrink-0 flex-wrap items-center gap-2 px-3 py-3 border-t border-border max-md:max-h-none! max-md:overflow-visible!">
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
        {kind === "writing" && (
          <select
            aria-label="Export document format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)}
            className="text-xs px-2 py-1.5 rounded border border-border bg-background"
          >
            <option value="source">Markdown</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word DOCX</option>
            <option value="xlsx">Excel XLSX</option>
            <option value="pptx">PowerPoint PPTX</option>
          </select>
        )}
        <button
          onClick={() =>
            kind === "writing" && exportFormat !== "source" ? void exportOffice() : exportDocument()
          }
          disabled={exporting}
          className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent disabled:opacity-50"
        >
          <Download className="mr-1 inline h-3.5 w-3.5" /> Export draft
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
            continueInChat(
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
          Ask Kova
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
            disabled={canPersistVersions && !remoteSnapshot?.canEdit}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            <Wand2 className="w-3.5 h-3.5 inline mr-1" />
            Improve with KovaGPT
          </button>
        )}
        <div className="ml-auto">
          <button onClick={requestClose} className="text-xs px-3 py-1.5 rounded hover:bg-accent">
            Close
          </button>
        </div>
      </div>
    </ArtifactEditorSurface>
  );
}
