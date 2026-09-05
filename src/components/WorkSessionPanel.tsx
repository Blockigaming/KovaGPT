import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWorkStoreRevision } from "@/hooks/use-work-store-revision";
import { loadWorkSessions, saveWorkSessions } from "@/lib/work-store";
import { readWorkSyncState } from "@/lib/work-sync-state";
import { WorkExecutionPanel } from "@/components/WorkExecutionPanel";
import {
  createWorkSession,
  updateWorkSession,
  branchWorkSession,
  validWorkSession,
  type WorkSession,
} from "@/lib/work-session.mjs";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";

type Draft = { objective: string; context: string; plan: string[] };
/** Saved planning remains separate from explicitly submitted execution. */
export function WorkSessionPanel({
  ownerId,
  prepared,
}: {
  ownerId: string | null;
  prepared: Draft | null;
}) {
  useWorkStoreRevision(ownerId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{
    id: string | null;
    base: string;
    objective: string;
    context: string;
    plan: string;
  } | null>(null);
  const [newObjective, setNewObjective] = useState("");
  const [, setPrivacyRevision] = useState(0);
  const generation = useRef(0);
  const currentGeneration = generation.current;
  useEffect(() => {
    const clear = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, ownerId)) return;
      generation.current += 1;
      setPrivacyRevision((value) => value + 1);
      setSelectedId(null);
      setEdit(null);
      setNewObjective("");
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    return () => {
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    };
  }, [ownerId]);
  const sessions = loadWorkSessions(ownerId).filter(validWorkSession);
  const selected = sessions.find((value) => value.id === selectedId);
  const perform = (action: () => void) => {
    try {
      if (generation.current !== currentGeneration)
        throw new Error("Session data changed. Open the current session before editing.");
      action();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The planning session could not be saved.",
      );
    }
  };
  const persist = (session: WorkSession, previous?: WorkSession) => {
    const current = loadWorkSessions(ownerId);
    if (
      previous &&
      JSON.stringify(current.find((value) => value.id === previous.id)) !== JSON.stringify(previous)
    )
      throw new Error("This session changed elsewhere. Reload the saved version before editing.");
    saveWorkSessions(ownerId, [session, ...current.filter((value) => value.id !== session.id)]);
    setSelectedId(session.id);
  };
  const start = (draft: Draft) =>
    perform(() => {
      persist(createWorkSession(draft));
      setNewObjective("");
      setEdit(null);
    });
  const openEditor = (session: WorkSession) =>
    setEdit({
      id: session.id,
      base: JSON.stringify(session),
      objective: session.objective,
      context: session.context,
      plan: session.steps.map((step) => step.text).join("\n"),
    });
  let revision = 0;
  if (ownerId && selected) {
    try {
      const state = readWorkSyncState(localStorage, ownerId);
      if (!state?.pending[selected.id]) revision = state?.records[selected.id]?.revision ?? 0;
    } catch {
      /* Retain local editing. */
    }
  }
  const button = "min-h-10 rounded-lg border px-3 py-2 text-sm disabled:opacity-40";
  return (
    <section className="my-4 rounded-2xl border bg-card p-4" aria-label="Planning sessions">
      <h2 className="text-lg font-semibold">Planning sessions</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Save a plan, record your progress, and explore a branch. These are your planning actions;
        background execution has not started.
      </p>
      {!ownerId && (
        <p className="mt-2 text-xs text-muted-foreground">
          Guest sessions stay on this device. Sign in for account sync.
        </p>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          start({ objective: newObjective, context: "", plan: [] });
        }}
      >
        <label className="min-w-48 flex-1 text-sm">
          New objective
          <input
            value={newObjective}
            onChange={(event) => setNewObjective(event.target.value)}
            maxLength={4000}
            className="mt-1 block w-full rounded-lg border bg-background p-2"
          />
        </label>
        <button className={button} disabled={!newObjective.trim()}>
          Create session
        </button>
        {prepared && (
          <button type="button" className={button} onClick={() => start(prepared)}>
            Save prepared plan
          </button>
        )}
      </form>
      {sessions.length > 0 && (
        <label className="mt-3 block text-sm">
          Saved session
          <select
            className="ml-2 max-w-full rounded-lg border bg-background p-2"
            value={selectedId ?? ""}
            onChange={(event) => {
              setSelectedId(event.target.value || null);
              setEdit(null);
            }}
          >
            <option value="">Choose a session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.objective.slice(0, 100)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <h3 className="break-words font-semibold">{selected.objective}</h3>
          <p className="text-xs text-muted-foreground">
            Your status: {selected.status}. {selected.events.length} planning actions recorded.
          </p>
          {selected.parent && (
            <p className="text-xs text-muted-foreground">
              Branched from saved revision {selected.parent.revision}.{" "}
              {sessions.some((value) => value.id === selected.parent!.id) ? (
                <button
                  className="underline"
                  onClick={() => {
                    setSelectedId(selected.parent!.id);
                    setEdit(null);
                  }}
                >
                  Open parent plan
                </button>
              ) : (
                "The parent plan is no longer available."
              )}
            </p>
          )}
          {edit?.id === selected.id ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                perform(() => {
                  if (JSON.stringify(selected) !== edit.base)
                    throw new Error(
                      "A newer saved version arrived. Reload it before applying your edits.",
                    );
                  const steps = edit.plan
                    .split("\n")
                    .map((text) => text.trim())
                    .filter(Boolean)
                    .map((text, index) =>
                      selected.steps[index]?.text === text
                        ? selected.steps[index]
                        : { id: crypto.randomUUID(), text, done: false },
                    );
                  persist(
                    updateWorkSession(
                      selected,
                      { objective: edit.objective.trim(), context: edit.context, steps },
                      "plan_updated",
                      "Plan edited",
                    ),
                    selected,
                  );
                  setEdit(null);
                });
              }}
            >
              <label className="block text-sm">
                Objective
                <input
                  className="mt-1 block w-full rounded-lg border bg-background p-2"
                  value={edit.objective}
                  maxLength={4000}
                  onChange={(event) => setEdit({ ...edit, objective: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                Context
                <textarea
                  className="mt-1 block w-full rounded-lg border bg-background p-2"
                  value={edit.context}
                  maxLength={16000}
                  onChange={(event) => setEdit({ ...edit, context: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                Plan — one step per line
                <textarea
                  className="mt-1 block min-h-32 w-full rounded-lg border bg-background p-2"
                  value={edit.plan}
                  onChange={(event) => setEdit({ ...edit, plan: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={button}>Save plan</button>
                <button type="button" className={button} onClick={() => openEditor(selected)}>
                  Reload saved version
                </button>
                <button type="button" className={button} onClick={() => setEdit(null)}>
                  Cancel edit
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm">{selected.context}</p>
              <ul className="space-y-2">
                {selected.steps.map((step) => (
                  <li key={step.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={step.done}
                        onChange={() =>
                          perform(() =>
                            persist(
                              updateWorkSession(
                                selected,
                                {
                                  steps: selected.steps.map((value) =>
                                    value.id === step.id ? { ...value, done: !value.done } : value,
                                  ),
                                },
                                "step_updated",
                                `${step.done ? "Reopened" : "Marked complete"}: ${step.text}`,
                              ),
                              selected,
                            ),
                          )
                        }
                      />
                      <span className="break-words">{step.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button className={button} onClick={() => openEditor(selected)}>
                  Edit plan
                </button>
                <button
                  className={button}
                  onClick={() =>
                    perform(() =>
                      persist(
                        updateWorkSession(
                          selected,
                          { status: selected.status === "paused" ? "planning" : "paused" },
                          "status_updated",
                          selected.status === "paused" ? "Planning resumed" : "Planning paused",
                        ),
                        selected,
                      ),
                    )
                  }
                >
                  {selected.status === "paused" ? "Resume planning" : "Pause planning"}
                </button>
                <button
                  className={button}
                  onClick={() =>
                    perform(() =>
                      persist(
                        updateWorkSession(
                          selected,
                          { status: selected.status === "completed" ? "planning" : "completed" },
                          "status_updated",
                          selected.status === "completed"
                            ? "Plan reopened"
                            : "User marked plan complete",
                        ),
                        selected,
                      ),
                    )
                  }
                >
                  {selected.status === "completed" ? "Reopen plan" : "Mark plan complete"}
                </button>
                <button
                  className={button}
                  disabled={!revision}
                  onClick={() =>
                    perform(() => {
                      persist(branchWorkSession(selected, revision));
                      setEdit(null);
                    })
                  }
                >
                  Start branch
                </button>
                <button
                  className={button}
                  onClick={() =>
                    perform(() => {
                      const prompt = `Help me work through this plan in chat. Do not claim background execution.\n\nObjective: ${selected.objective}\n\nContext: ${selected.context}\n\nPlan:\n${selected.steps.map((step) => `${step.done ? "[done]" : "[pending]"} ${step.text}`).join("\n")}`;
                      if (
                        !writePrincipalHandoff(
                          safeBrowserStorage("sessionStorage"),
                          "kova-app-chat-context",
                          ownerId,
                          prompt,
                        ).ok
                      )
                        throw new Error("The plan could not be opened in chat. Please try again.");
                      window.location.assign("/");
                    })
                  }
                >
                  Continue in chat
                </button>
                <button
                  className={button}
                  onClick={() =>
                    perform(() => {
                      const current = loadWorkSessions(ownerId);
                      if (
                        JSON.stringify(current.find((value) => value.id === selected.id)) !==
                        JSON.stringify(selected)
                      )
                        throw new Error(
                          "This session changed elsewhere. Review the current version before deleting it.",
                        );
                      saveWorkSessions(
                        ownerId,
                        current.filter((value) => value.id !== selected.id),
                      );
                      setSelectedId(null);
                      setEdit(null);
                    })
                  }
                >
                  Delete session
                </button>
              </div>
              {!revision && (
                <p className="text-xs text-muted-foreground">
                  Branching becomes available after this session is saved to your account.
                </p>
              )}
            </>
          )}
          <details>
            <summary className="min-h-10 cursor-pointer py-2 text-sm">Planning history</summary>
            <ol className="max-h-72 space-y-2 overflow-auto text-sm">
              {selected.events.map((event) => (
                <li key={event.id}>
                  <time className="text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()}
                  </time>
                  <p className="break-words">{event.label}</p>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
      {ownerId && !edit && (!selected || revision > 0) && (
        <WorkExecutionPanel
          key={`${ownerId}:${generation.current}:${selected?.id ?? "new"}:${revision}`}
          ownerId={ownerId}
          initialObjective={selected?.objective ?? ""}
          source="work"
          session={selected ? { id: selected.id, revision } : null}
        />
      )}
      {ownerId && selected && !revision && (
        <p className="mt-3 text-sm text-muted-foreground">
          Save this plan to your account before submitting it for execution.
        </p>
      )}
    </section>
  );
}
