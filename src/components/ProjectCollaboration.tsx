import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AtSign, MessageCircle, Send, Trash2 } from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";
import type { ProjectComment } from "@/lib/professional.functions";
import { collaborationRequest, useCollaborationPresence } from "@/lib/collaboration";
import { CollaborationStatus } from "@/components/CollaborationStatus";
import type { ProjectMember } from "@/lib/projects.functions";
import { toast } from "sonner";
import { z } from "zod";
const Comments = z
  .array(
    z.object({
      id: z.string().uuid(),
      project_id: z.string().uuid(),
      author_id: z.string().uuid(),
      body: z.string().max(8000),
      anchor: z.string().max(400).nullable(),
      mentions: z.array(z.string().uuid()).max(20),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  )
  .max(100);
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
type Props = { projectId: string; members: ProjectMember[]; role: "owner" | "editor" | "viewer" };
export function ProjectCollaboration(props: Props) {
  const { user } = useUser();
  return (
    <ProjectCollaborationSession
      key={JSON.stringify([props.projectId, user?.id])}
      {...props}
      userId={user?.id}
    />
  );
}
function ProjectCollaborationSession({
  projectId,
  members,
  role,
  userId,
}: Props & { userId?: string }) {
  const [comments, setComments] = useState<ProjectComment[]>([]),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false),
    [error, setError] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [anchor, setAnchor] = useState("General"),
    [mentions, setMentions] = useState<string[]>([]),
    [sending, setSending] = useState(false),
    [onlyMentions, setOnlyMentions] = useState(false),
    [deletingComment, setDeletingComment] = useState<ProjectComment | null>(null),
    [deletePending, setDeletePending] = useState(false);
  const scopeKey = JSON.stringify([projectId, userId]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      const rows = await collaborationRequest(userId, "project_comments", { projectId }, signal);
      if (scopeRef.current !== scopeKey || signal?.aborted) return;
      const parsed = Comments.parse(rows);
      if (parsed.some((comment) => comment.project_id !== projectId))
        throw new Error("Comments could not be loaded.");
      setComments(parsed);
      setDenied(false);
      setError(null);
      setLoading(false);
    },
    [projectId, userId, scopeKey],
  );
  useEffect(() => {
    const controller = new AbortController();
    setComments([]);
    setDenied(false);
    setError(null);
    setBody("");
    setMentions([]);
    setLoading(true);
    setSending(false);
    setDeletePending(false);
    setDeletingComment(null);
    attempt.current = null;
    void refresh(controller.signal).catch((error) => {
      if (scopeRef.current === scopeKey && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Comments could not be loaded.");
        setLoading(false);
      }
    });
    return () => {
      scopeRef.current = "";
      controller.abort();
    };
  }, [scopeKey, refresh]);
  const presence = useCollaborationPresence({
    kind: "project",
    id: denied ? null : projectId,
    userId: userId ?? null,
    onRefresh: refresh,
    onDenied: () => {
      setDenied(true);
      setComments([]);
      setError("You no longer have access to this Project.");
    },
  });
  const visible = useMemo(
    () =>
      comments.filter((comment) => !onlyMentions || (userId && comment.mentions.includes(userId))),
    [comments, onlyMentions, userId],
  );
  const submit = async () => {
    if (!body.trim() || role === "viewer" || !userId) return;
    setSending(true);
    try {
      const key = JSON.stringify([body, anchor, mentions]);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const rows = await collaborationRequest(userId, "project_comment", {
        projectId,
        body,
        anchor,
        mentions,
        commentId: attempt.current.id,
      });
      if (scopeRef.current !== scopeKey) return;
      setComments(Comments.parse(rows));
      attempt.current = null;
      setBody("");
      setMentions([]);
      toast.success("Comment posted");
    } catch (e) {
      if (scopeRef.current === scopeKey)
        toast.error(e instanceof Error ? e.message : "Comment could not be posted");
    } finally {
      if (scopeRef.current === scopeKey) setSending(false);
    }
  };
  return (
    <section aria-labelledby="collaboration-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="collaboration-heading" className="font-semibold">
            Project collaboration
          </h2>
          <p className="text-sm text-muted-foreground">
            Owners manage roles; editors contribute; viewers read. The latest 100 comments update
            live while this panel is open.
          </p>
        </div>
        <CollaborationStatus {...presence} />
        <button
          aria-pressed={onlyMentions}
          onClick={() => setOnlyMentions((v) => !v)}
          className={`min-h-10 rounded-lg border px-3 text-sm ${onlyMentions ? "bg-foreground text-background" : ""}`}
        >
          <AtSign className="mr-1 inline h-4 w-4" />
          My mentions
        </button>
      </div>
      {role !== "viewer" && !denied ? (
        <div className="mt-4 rounded-2xl border p-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            className="min-h-24 w-full resize-y bg-transparent outline-none"
            placeholder="Add a project comment or inline note…"
            aria-label="Project comment"
          />
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <select
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
              aria-label="Comment location"
            >
              <option>General</option>
              <option>Notes</option>
              <option>Tasks</option>
              <option>Files</option>
              <option>Instructions</option>
            </select>
            <details className="relative">
              <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border px-3 text-sm">
                <AtSign className="mr-1 h-4 w-4" />
                Mention {mentions.length || "member"}
              </summary>
              <div className="absolute left-0 z-20 mt-1 max-h-52 w-64 overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg">
                {members.map((member) => (
                  <label
                    key={member.user_id}
                    className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={mentions.includes(member.user_id)}
                      onChange={() =>
                        setMentions((all) =>
                          all.includes(member.user_id)
                            ? all.filter((id) => id !== member.user_id)
                            : [...all, member.user_id],
                        )
                      }
                    />
                    <span className="truncate text-sm">
                      {member.email ?? member.user_id.slice(0, 8)}
                    </span>
                    <span className="ml-auto text-xs capitalize text-muted-foreground">
                      {member.role}
                    </span>
                  </label>
                ))}
              </div>
            </details>
            <button
              disabled={sending || !body.trim()}
              onClick={submit}
              className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg bg-foreground px-3 text-sm text-background disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {sending ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          Viewers can read collaboration activity but cannot post or edit Project content.
        </div>
      )}
      {loading ? (
        <div aria-label="Loading project comments" className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="mt-4 rounded-xl border border-destructive/40 p-3">
          {error}
          <button
            className="ml-3 min-h-9 underline"
            onClick={() => void refresh().catch(() => toast.error("Reconnect failed."))}
          >
            Reconnect
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-4 rounded-2xl border p-8 text-center">
          <MessageCircle className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-medium">No collaboration comments</p>
          <p className="text-sm text-muted-foreground">
            Add the first note or change the mentions filter.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((comment) => (
            <li
              key={comment.id}
              className={`rounded-2xl border p-4 ${userId && comment.mentions.includes(userId) ? "border-primary/40 bg-primary/5" : "bg-card/40"}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {members.find((member) => member.user_id === comment.author_id)?.email ??
                        "Project member"}
                    </span>
                    <span>{comment.anchor}</span>
                    <time dateTime={comment.created_at}>
                      {new Date(comment.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
                  {comment.mentions.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <AtSign className="mr-1 inline h-3 w-3" />
                      {comment.mentions.length} mentioned
                    </p>
                  )}
                </div>
                {(comment.author_id === userId || role === "owner") && (
                  <button
                    aria-label="Delete comment"
                    onClick={() => setDeletingComment(comment)}
                    className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmActionDialog
        open={Boolean(deletingComment)}
        onOpenChange={(open) => !open && !deletePending && setDeletingComment(null)}
        title="Delete project comment?"
        description="This comment will be permanently removed for every project member."
        confirmLabel={deletePending ? "Deleting…" : "Delete comment"}
        destructive
        disabled={deletePending}
        onConfirm={async () => {
          if (!deletingComment || deletePending || !userId) return;
          setDeletePending(true);
          try {
            const rows = await collaborationRequest(userId, "project_comment_delete", {
              projectId,
              commentId: deletingComment.id,
            });
            if (scopeRef.current !== scopeKey) return;
            setComments(Comments.parse(rows));
            setDeletingComment(null);
            toast.success("Comment deleted");
          } catch (error) {
            if (scopeRef.current === scopeKey)
              toast.error(error instanceof Error ? error.message : "Comment could not be deleted");
          } finally {
            if (scopeRef.current === scopeKey) setDeletePending(false);
          }
        }}
      />
    </section>
  );
}
