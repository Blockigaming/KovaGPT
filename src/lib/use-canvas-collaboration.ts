import { useCallback, useEffect, useRef, useState } from "react";
import {
  collaborationRequest,
  parseCanvasSnapshot,
  useCollaborationPresence,
  type CanvasSnapshot,
} from "./collaboration";
import { CollaborationError, mergeCanvasSnapshot } from "./collaboration-client.mjs";

export function useCanvasCollaboration({
  open,
  actorId,
  chatId,
  messageId,
  projectId,
  initialContent,
}: {
  open: boolean;
  actorId: string | null;
  chatId?: string | null;
  messageId?: string | null;
  projectId?: string | null;
  initialContent: string;
}) {
  const key =
    open && actorId && chatId && messageId
      ? JSON.stringify([actorId, chatId, messageId, projectId ?? null])
      : null;
  const epoch = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [stored, setStored] = useState<{ key: string; snapshot: CanvasSnapshot } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const base = useRef<{ key: string; revision: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const snapshot = stored?.key === key ? stored.snapshot : null;
  const documentId = snapshot?.document.id ?? null;
  const parse = useCallback(
    (value: unknown) => {
      const result = parseCanvasSnapshot(value, actorId ?? "", projectId);
      if (result.document.chat_id !== chatId || result.document.message_id !== messageId)
        throw new CollaborationError("42501");
      return result;
    },
    [actorId, projectId, chatId, messageId],
  );
  useEffect(() => {
    const generation = ++epoch.current;
    setStored(null);
    setFailure(null);
    setConflictKey(null);
    base.current = null;
    if (!key || !actorId) return;
    const controller = new AbortController();
    void collaborationRequest(
      actorId,
      "open",
      { chatId, messageId, projectId: projectId ?? null, content: initialContent },
      controller.signal,
    )
      .then((value) => {
        if (epoch.current !== generation || keyRef.current !== key || controller.signal.aborted)
          return;
        const result = parse(value);
        base.current = { key, revision: result.document.revision };
        setStored({ key, snapshot: result });
      })
      .catch((error) => {
        if (epoch.current === generation && keyRef.current === key && !controller.signal.aborted)
          setFailure({
            key,
            message: error instanceof Error ? error.message : "Canvas could not be loaded.",
          });
      });
    return () => {
      epoch.current = generation + 1;
      controller.abort();
    };
  }, [key, actorId, chatId, messageId, projectId, initialContent, parse, retry]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!key || !actorId || !documentId) return;
      const generation = epoch.current;
      const result = parse(await collaborationRequest(actorId, "get", { documentId }, signal));
      if (epoch.current !== generation || keyRef.current !== key || signal?.aborted) return;
      if (base.current?.key === key && result.document.revision < base.current.revision) return;
      if (base.current?.key === key && result.document.revision > base.current.revision)
        setConflictKey(key);
      setStored((previous) => ({
        key,
        snapshot: mergeCanvasSnapshot(previous?.key === key ? previous.snapshot : null, result),
      }));
    },
    [key, actorId, documentId, parse],
  );
  const presence = useCollaborationPresence({
    kind: "canvas",
    id: documentId,
    userId: key ? actorId : null,
    onRefresh: refresh,
    onDenied: () => {
      if (key) {
        setStored(null);
        setFailure({
          key,
          message: "You no longer have access to this Canvas. Your local draft is preserved.",
        });
      }
    },
  });
  const adopt = useCallback(() => {
    if (!key || !snapshot) return null;
    base.current = { key, revision: snapshot.document.revision };
    setConflictKey(null);
    setFailure(null);
    return snapshot.document.content;
  }, [key, snapshot]);
  const editable = snapshot?.canEdit ?? false;
  const save = useCallback(
    async (content: string) => {
      if (
        !key ||
        !actorId ||
        !documentId ||
        !editable ||
        keyRef.current !== key ||
        base.current?.key !== key ||
        conflictKey === key
      )
        throw new CollaborationError("40001");
      const generation = epoch.current;
      const revision = base.current.revision;
      try {
        const result = parse(
          await collaborationRequest(actorId, "save", {
            documentId,
            expectedRevision: revision,
            content,
          }),
        );
        if (epoch.current !== generation || keyRef.current !== key)
          throw new CollaborationError("cancelled");
        base.current = { key, revision: result.document.revision };
        setStored((previous) => ({
          key,
          snapshot: mergeCanvasSnapshot(previous?.key === key ? previous.snapshot : null, result),
        }));
        setFailure(null);
      } catch (error) {
        if (
          epoch.current === generation &&
          keyRef.current === key &&
          error instanceof CollaborationError &&
          error.code === "40001"
        ) {
          setConflictKey(key);
          void refresh().catch(() => {});
        }
        throw error;
      }
    },
    [key, actorId, documentId, editable, conflictKey, parse, refresh],
  );
  const commentMutation = async (
    operation: "comment" | "delete_comment",
    data: Record<string, unknown>,
  ) => {
    if (!key || !actorId || !snapshot || base.current?.key !== key)
      throw new CollaborationError("42501");
    const generation = epoch.current;
    const result = parse(
      await collaborationRequest(actorId, operation, {
        documentId: snapshot.document.id,
        expectedRevision: base.current.revision,
        commentEpoch: snapshot.document.comment_epoch,
        ...data,
      }),
    );
    if (epoch.current !== generation || keyRef.current !== key)
      throw new CollaborationError("cancelled");
    setStored((previous) => ({
      key,
      snapshot: mergeCanvasSnapshot(previous?.key === key ? previous.snapshot : null, result),
    }));
  };
  const versionContent = async (revision: number) => {
    if (!key || !actorId || !snapshot) throw new CollaborationError("42501");
    const generation = epoch.current;
    const result = await collaborationRequest(actorId, "get_version", {
      documentId: snapshot.document.id,
      revision,
    });
    if (
      epoch.current !== generation ||
      keyRef.current !== key ||
      typeof result !== "object" ||
      result === null ||
      !("content" in result) ||
      typeof result.content !== "string"
    )
      throw new CollaborationError("unavailable");
    return result.content;
  };
  const olderComments = async () => {
    const last = snapshot?.comments.at(-1);
    if (!key || !actorId || !snapshot || !last) return;
    const generation = epoch.current;
    const result = parse(
      await collaborationRequest(actorId, "get", {
        documentId: snapshot.document.id,
        beforeId: last.id,
        beforeCreatedAt: last.created_at,
      }),
    );
    if (epoch.current !== generation || keyRef.current !== key) return;
    if (result.document.comment_epoch !== snapshot.document.comment_epoch) {
      await refresh();
      return;
    }
    setStored((previous) => ({
      key,
      snapshot: mergeCanvasSnapshot(previous?.key === key ? previous.snapshot : null, result),
    }));
  };
  return {
    snapshot,
    save,
    adopt,
    refresh,
    commentMutation,
    versionContent,
    olderComments,
    presence,
    conflict: conflictKey === key,
    error: failure?.key === key ? failure.message : null,
    retry: () => setRetry((value) => value + 1),
    ready: Boolean(snapshot),
  };
}
