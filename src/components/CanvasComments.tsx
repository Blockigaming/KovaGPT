import { useRef, useState } from "react";
import { toast } from "sonner";
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
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ key: string; id: string; commentEpoch: number } | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Comment could not be saved.");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <h2 className="text-sm font-semibold">Comments</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {snapshot.document.project_id
          ? "Saved for Project members."
          : "Saved privately with this Canvas."}
      </p>
      {snapshot.canEdit && (
        <>
          <textarea
            value={draft}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-3 min-h-20 w-full rounded-lg border bg-background p-2 text-xs"
            placeholder="Comment on the document or selected text"
            aria-label="Artifact comment"
          />
          {dirty && (
            <p className="mt-1 text-xs text-muted-foreground">
              Save or resolve your draft before anchoring a comment.
            </p>
          )}
          <button
            disabled={pending || dirty || !draft.trim()}
            onClick={() =>
              void run(async () => {
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
                setDraft("");
                attempt.current = null;
              })
            }
            className="mt-2 min-h-9 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add comment"}
          </button>
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
                      <button
                        className="mb-2 underline"
                        onClick={() => onSelect(anchor.start!, anchor.end!)}
                      >
                        {anchor.state === "moved" ? "Find moved selection" : "Find selection"}
                      </button>
                    )}
                  </>
                )}
                <p className="whitespace-pre-wrap">{comment.body}</p>
                <time className="mt-1 block text-muted-foreground" dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleString()}
                </time>
                {(comment.author_id === actorId || snapshot.canManageComments) && (
                  <button
                    disabled={pending}
                    onClick={() => void run(() => onDelete(comment.id))}
                    className="mt-2 min-h-9 text-destructive"
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {snapshot.comments.length >= 100 && snapshot.comments.length % 100 === 0 && (
        <button
          disabled={pending}
          onClick={() => void run(onOlder)}
          className="mt-3 min-h-9 text-xs underline"
        >
          Load older comments
        </button>
      )}
    </>
  );
}
