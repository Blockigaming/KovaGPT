import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AtSign, MessageCircle, Send, Trash2 } from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  addProjectComment,
  deleteProjectComment,
  listProjectComments,
  type ProjectComment,
} from "@/lib/professional.functions";
import type { ProjectMember } from "@/lib/projects.functions";
import { toast } from "sonner";
import { RealtimeReadiness } from "@/components/RealtimeReadiness";
export function ProjectCollaboration({
  projectId,
  members,
  role,
}: {
  projectId: string;
  members: ProjectMember[];
  role: "owner" | "editor" | "viewer";
}) {
  const { user } = useUser();
  const list = useServerFn(listProjectComments),
    add = useServerFn(addProjectComment),
    remove = useServerFn(deleteProjectComment);
  const [comments, setComments] = useState<ProjectComment[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [anchor, setAnchor] = useState("General"),
    [mentions, setMentions] = useState<string[]>([]),
    [sending, setSending] = useState(false),
    [onlyMentions, setOnlyMentions] = useState(false);
  const userId = (user as { id?: string } | null)?.id;
  useEffect(() => {
    setLoading(true);
    list({ data: { project_id: projectId } })
      .then(setComments)
      .catch((e) => setError(e instanceof Error ? e.message : "Comments could not be loaded"))
      .finally(() => setLoading(false));
  }, [projectId, list]);
  const visible = useMemo(
    () =>
      comments.filter((comment) => !onlyMentions || (userId && comment.mentions.includes(userId))),
    [comments, onlyMentions, userId],
  );
  const submit = async () => {
    if (!body.trim() || role === "viewer") return;
    setSending(true);
    try {
      const comment = await add({ data: { project_id: projectId, body, anchor, mentions } });
      setComments((all) => [comment, ...all]);
      setBody("");
      setMentions([]);
      toast.success("Comment posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Comment could not be posted");
    } finally {
      setSending(false);
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
            Owners manage roles; editors contribute; viewers read. Comments refresh when this panel
            opens and are ready for a future realtime subscription.
          </p>
        </div>
        <RealtimeReadiness resource="Project" />
        <button
          aria-pressed={onlyMentions}
          onClick={() => setOnlyMentions((v) => !v)}
          className={`min-h-10 rounded-lg border px-3 text-sm ${onlyMentions ? "bg-foreground text-background" : ""}`}
        >
          <AtSign className="mr-1 inline h-4 w-4" />
          My mentions
        </button>
      </div>
      {role !== "viewer" ? (
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
                    onClick={async () => {
                      if (!confirm("Delete this comment?")) return;
                      try {
                        await remove({ data: { id: comment.id } });
                        setComments((all) => all.filter((value) => value.id !== comment.id));
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Comment could not be deleted",
                        );
                      }
                    }}
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
    </section>
  );
}
