import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useId, useRef, useState } from "react";
import { useScopedActionFeedback } from "@/lib/use-scoped-action-feedback";
import {
  ResultCommentDeleteDialog,
  type ResultCommentDeleteTarget,
} from "@/components/ResultCommentDeleteDialog";
import { resolveCommentAnchor } from "@/lib/collaboration-client.mjs";
import type { CanvasSnapshot } from "@/lib/collaboration";
export function CanvasComments({
  snapshot,
  value,
  actorId,
  dirty,
  onComment,
  onDelete,
  onOlder,
  onSelect,
  selection,
}: {
  snapshot: CanvasSnapshot;
  value: string;
  actorId: string | null;
  dirty: boolean;
  onComment: (data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOlder: () => Promise<void>;
  onSelect: (start: number, end: number) => void;
  selection: () => { start: number; end: number } | null;
}) {
  const scope = JSON.stringify([actorId, snapshot.document.id]);
  const feedback = useScopedActionFeedback(scope);
  const commentFieldId = useId();
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResultCommentDeleteTarget | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ key: string; id: string; commentEpoch: number } | null>(null);
  const run = async (
    action: (isCurrent: () => boolean) => Promise<void>,
    operation = "comment",
  ) => {
    const ticket = feedback.begin(operation);
    if (!ticket) return;
    setPending(true);
    try {
      await action(() => feedback.current(ticket));
      feedback.finish(ticket);
    } catch (error) {
      feedback.finish(
        ticket,
        operation === "older"
          ? `Older comments could not be loaded. ${error instanceof Error ? error.message : "Try Load older comments again."} Your current comments and draft remain visible.`
          : `${error instanceof Error ? error.message : "The comment request could not be confirmed."} Your draft is preserved. If a save was already accepted, retrying the same comment keeps its existing request identity.`,
      );
    } finally {
      // A different actor/document is never updated by this request.
      if (feedback.scopeCurrent(ticket)) setPending(false);
    }
  };
  return (
    <>
      <h2 ref={commentsHeadingRef} tabIndex={-1} className="text-sm font-semibold">
        Comments
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {snapshot.document.project_id
          ? "Saved for Project members."
          : "Saved privately with this Canvas."}
      </p>
      {snapshot.canEdit && (
        <>
          <label htmlFor={commentFieldId} className="mt-3 block text-sm font-medium">
            Comment
          </label>
          <Textarea
            ref={commentInputRef}
            id={commentFieldId}
            value={draft}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-3 min-h-20 w-full border bg-background text-xs"
            placeholder="Comment on the document or selected text"
            aria-label="Artifact comment"
          />
          {dirty && (
            <p className="mt-1 text-xs text-muted-foreground">
              Save or resolve your draft before anchoring a comment.
            </p>
          )}
          <Button
            variant="default"
            disabled={pending || dirty || !draft.trim()}
            onClick={() => {
              // Focus a retained input before Add becomes disabled or its draft clears.
              commentInputRef.current?.focus({ preventScroll: true });
              void run(async (isCurrent) => {
                const range = selection();
                const key = JSON.stringify([draft.trim(), range, snapshot.document.revision]);
                if (attempt.current?.key !== key)
                  attempt.current = {
                    key,
                    id: crypto.randomUUID(),
                    commentEpoch: snapshot.document.comment_epoch,
                  };
                await onComment({
                  commentId: attempt.current.id,
                  commentEpoch: attempt.current.commentEpoch,
                  body: draft.trim(),
                  ...(range ?? {}),
                });
                if (!isCurrent()) return;
                if (draftRef.current === draft) setDraft("");
                attempt.current = null;
              });
            }}
            className="mt-2 bg-foreground text-xs text-background disabled:opacity-50"
          >
            {pending ? (
              <span className="spec400-loading-label">
                <span className="spec400-loading-spinner" aria-hidden="true" />
                Saving…
              </span>
            ) : (
              "Add comment"
            )}
          </Button>
        </>
      )}
      {!snapshot.comments.length ? (
        <p className="mt-4 text-xs text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {snapshot.comments.map((comment) => {
            const anchor = resolveCommentAnchor(value, comment.anchor);
            return (
              <li key={comment.id} className="rounded-lg border bg-background p-2 text-xs">
                {comment.anchor && (
                  <>
                    <blockquote className="mb-1 border-l-2 pl-2 text-muted-foreground">
                      {comment.anchor.quote}
                    </blockquote>
                    {anchor.state === "removed" ? (
                      <p className="mb-2 text-amber-700 dark:text-amber-300">
                        Selection changed or removed
                      </p>
                    ) : (
                      <Button
                        variant="link"
                        className="mb-2 underline"
                        onClick={() => onSelect(anchor.start!, anchor.end!)}
                      >
                        {anchor.state === "moved" ? "Find moved selection" : "Find selection"}
                      </Button>
                    )}
                  </>
                )}
                <p className="whitespace-pre-wrap">{comment.body}</p>
                <time className="mt-1 block text-muted-foreground" dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleString()}
                </time>
                {(comment.author_id === actorId || snapshot.canManageComments) && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={(event) =>
                      setDeleteTarget({
                        id: comment.id,
                        body: comment.body,
                        scope,
                        trigger: event.currentTarget,
                        url: window.location.href,
                      })
                    }
                    className="mt-2 text-destructive"
                  >
                    Delete comment
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {Object.entries(feedback.errors).map(([operation, message]) => (
        <p key={operation} role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      ))}
      <ResultCommentDeleteDialog
        target={deleteTarget}
        scope={scope}
        durable
        fallbackRef={commentsHeadingRef}
        onClose={() => setDeleteTarget(null)}
        onDelete={async (id) => {
          const comment = snapshot.comments.find((item) => item.id === id);
          if (!comment || !(comment.author_id === actorId || snapshot.canManageComments))
            throw new Error("The selected comment is no longer available to delete.");
          await onDelete(String(id));
        }}
      />
      {snapshot.comments.length >= 100 && snapshot.comments.length % 100 === 0 && (
        <Button
          variant="link"
          disabled={pending}
          onClick={() => {
            // A page read can remove this button when the final page arrives.
            commentsHeadingRef.current?.focus({ preventScroll: true });
            void run(onOlder, "older");
          }}
          className="mt-3 text-xs underline"
        >
          Load older comments
        </Button>
      )}
    </>
  );
}
