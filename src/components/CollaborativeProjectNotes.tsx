import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useUser } from "@/components/auth/ClerkSafe";
import { collaborationRequest, useCollaborationPresence } from "@/lib/collaboration";
import { CollaborationError } from "@/lib/collaboration-client.mjs";
import { CollaborationStatus } from "./CollaborationStatus";
import { toast } from "sonner";
const Note = z.object({
  project_id: z.string().uuid(),
  content: z.string().max(400000),
  revision: z.number().int().nonnegative(),
});
type Note = z.infer<typeof Note>;
type State = {
  key: string;
  note: Note | null;
  draft: string;
  remote: Note | null;
  error: string | null;
  saving: boolean;
  denied: boolean;
};
export function CollaborativeProjectNotes(props: { projectId: string; canEdit: boolean }) {
  const { user } = useUser();
  return (
    <ProjectNotesSession
      key={JSON.stringify([user?.id, props.projectId])}
      {...props}
      actor={user?.id ?? null}
    />
  );
}
function ProjectNotesSession({
  projectId,
  canEdit,
  actor,
}: {
  projectId: string;
  canEdit: boolean;
  actor: string | null;
}) {
  const key = JSON.stringify([actor, projectId]);
  const scope = useRef(key);
  scope.current = key;
  const [stored, setStored] = useState<State>({
    key,
    note: null,
    draft: "",
    remote: null,
    error: null,
    saving: false,
    denied: false,
  });
  const state = stored.key === key ? stored : null;
  const parse = useCallback(
    (value: unknown) => {
      const note = Note.parse(value);
      if (note.project_id !== projectId) throw new CollaborationError("42501");
      return note;
    },
    [projectId],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!actor) return;
      const note = parse(await collaborationRequest(actor, "note_get", { projectId }, signal));
      if (scope.current !== key || signal?.aborted) return;
      setStored((current) => {
        if (current.key !== key || !current.note)
          return {
            key,
            note,
            draft: note.content,
            remote: null,
            error: null,
            saving: false,
            denied: false,
          };
        if (note.revision < current.note.revision) return current;
        if (current.draft === current.note.content && !current.saving)
          return {
            ...current,
            note,
            draft: note.content,
            remote: null,
            error: null,
            denied: false,
          };
        return {
          ...current,
          remote: note.revision > current.note.revision ? note : current.remote,
          denied: false,
          error: null,
        };
      });
    },
    [actor, projectId, key, parse],
  );
  useEffect(() => {
    const controller = new AbortController();
    setStored({
      key,
      note: null,
      draft: "",
      remote: null,
      error: null,
      saving: false,
      denied: false,
    });
    void refresh(controller.signal).catch((error) => {
      if (scope.current === key && !controller.signal.aborted)
        setStored((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Notes could not be loaded.",
        }));
    });
    return () => {
      scope.current = "";
      controller.abort();
    };
  }, [key, refresh]);
  const presence = useCollaborationPresence({
    kind: "project",
    id: state?.note && !state.denied ? projectId : null,
    userId: actor,
    onRefresh: refresh,
    onDenied: () =>
      setStored((current) => ({
        ...current,
        denied: true,
        error: "Project access changed. Your draft is preserved.",
      })),
  });
  useEffect(() => {
    if (
      !actor ||
      !state?.note ||
      state.saving ||
      state.remote ||
      state.error ||
      state.denied ||
      !canEdit ||
      state.draft === state.note.content
    )
      return;
    const snapshot = state.draft;
    const expectedRevision = state.note.revision;
    const timer = setTimeout(() => {
      if (scope.current !== key) return;
      setStored((current) => ({ ...current, saving: true }));
      void collaborationRequest(actor, "note_save", {
        projectId,
        content: snapshot,
        expectedRevision,
      })
        .then((value) => {
          if (scope.current !== key) return;
          const note = parse(value);
          setStored((current) => ({
            ...current,
            note,
            saving: false,
            error: null,
            remote:
              current.remote && current.remote.revision > note.revision ? current.remote : null,
          }));
        })
        .catch((error) => {
          if (scope.current !== key) return;
          setStored((current) => ({
            ...current,
            saving: false,
            error: error instanceof Error ? error.message : "Notes could not be saved.",
          }));
          if (error instanceof CollaborationError && error.code === "40001")
            void refresh().catch(() => {});
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [actor, projectId, key, state, canEdit, parse, refresh]);
  return (
    <section aria-label="Shared Project notes">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Shared notes for this Project.</p>
        <CollaborationStatus {...presence} />
      </div>
      <textarea
        value={state?.draft ?? ""}
        disabled={!state?.note || !canEdit || state.denied}
        onChange={(event) => setStored((current) => ({ ...current, draft: event.target.value }))}
        maxLength={200000}
        rows={16}
        className="w-full rounded-lg border bg-background p-3 font-mono text-sm disabled:opacity-60"
        aria-label="Project notes"
        placeholder={
          !state?.note
            ? "Loading notes…"
            : canEdit
              ? "Start writing shared notes for the team…"
              : "No notes yet."
        }
      />
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {state?.saving
          ? "Saving…"
          : state?.note && state.draft === state.note.content
            ? "Saved"
            : "Draft kept in this open editor"}
      </p>
      {(state?.remote || state?.error) && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-500/40 p-3 text-sm">
          <p>
            {state.remote
              ? "Someone saved a newer version. Copy your draft before loading it."
              : state.error}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="min-h-9 rounded border px-3"
              onClick={() =>
                void navigator.clipboard
                  .writeText(state.draft)
                  .then(() => toast.success("Draft copied"))
                  .catch(() => toast.error("Copy failed; select and copy your draft."))
              }
            >
              Copy my draft
            </button>
            {state.remote ? (
              <button
                className="min-h-9 rounded border px-3"
                onClick={() =>
                  setStored((current) =>
                    current.remote
                      ? {
                          ...current,
                          note: current.remote,
                          draft: current.remote.content,
                          remote: null,
                          error: null,
                        }
                      : current,
                  )
                }
              >
                Load current version
              </button>
            ) : (
              <button
                className="min-h-9 rounded border px-3"
                onClick={() =>
                  void refresh().catch((error) =>
                    toast.error(error instanceof Error ? error.message : "Reconnect failed."),
                  )
                }
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
