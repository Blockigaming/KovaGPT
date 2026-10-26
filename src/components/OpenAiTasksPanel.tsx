import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  loadOpenAiTaskAvailability,
  submitOpenAiTask,
  type OpenAiTaskAvailability,
  type OpenAiTaskOperation,
} from "@/lib/openai-task-client.mjs";

export function OpenAiTasksPanel({ ownerId }: { ownerId: string | null }) {
  const [availability, setAvailability] = useState<OpenAiTaskAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [operation, setOperation] = useState<OpenAiTaskOperation>("agent");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    ownerId: string;
    text: string;
    toolCalls?: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const owner = useRef(ownerId);
  const active = useRef<AbortController | null>(null);
  owner.current = ownerId;

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setResult(null);
    setError("");
    setAvailability(null);
    if (!ownerId) return;
    const controller = new AbortController();
    setChecking(true);
    void loadOpenAiTaskAvailability(ownerId, { signal: controller.signal })
      .then((next) => {
        if (owner.current === ownerId && !controller.signal.aborted) {
          setAvailability(next);
          setOperation(next.agent ? "agent" : "browser");
        }
      })
      .catch((reason) => {
        if (owner.current === ownerId && !controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Task availability could not be loaded.",
          );
      })
      .finally(() => {
        if (owner.current === ownerId && !controller.signal.aborted) setChecking(false);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [ownerId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerId || running || !availability?.[operation] || !input.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const answer = await submitOpenAiTask(
        { ownerId, operation, input, requestId: crypto.randomUUID() },
        { signal: controller.signal },
      );
      if (owner.current === ownerId && active.current === controller && !controller.signal.aborted)
        setResult({ ownerId, ...answer });
    } catch (reason) {
      if (owner.current === ownerId && active.current === controller)
        setError(
          controller.signal.aborted
            ? "Task cancelled. A task already started may still count toward usage."
            : reason instanceof Error
              ? reason.message
              : "The task could not be completed.",
        );
    } finally {
      if (owner.current === ownerId && active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }

  return (
    <section className="my-4 rounded-2xl border bg-card p-4" aria-label="OpenAI tasks">
      <h2 className="text-lg font-semibold">OpenAI tasks</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Run one hosted Agent task or a public-page Browser task. These results are separate from
        saved Work runs.
      </p>
      {!ownerId ? (
        <p className="mt-3 text-sm" role="status">
          Sign in to check task availability.
        </p>
      ) : (
        <>
          {checking && (
            <p className="mt-3 text-sm" role="status">
              Checking availability…
            </p>
          )}
          {availability && !availability.configured && (
            <p className="mt-3 text-sm" role="status">
              OpenAI tasks are unavailable right now.
            </p>
          )}
          {availability?.configured && !availability.agent && !availability.browser && (
            <p className="mt-3 text-sm" role="status">
              These tasks require a verified Kova Plus or Pro account. Hosted Browser also needs
              approved public domains.
            </p>
          )}
          {availability?.configured && (availability.agent || availability.browser) && (
            <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3">
              <label className="block text-sm">
                Task type
                <select
                  className="mt-1 block min-h-11 w-full rounded-lg border bg-background p-2"
                  value={operation}
                  onChange={(event) => {
                    setOperation(event.target.value as OpenAiTaskOperation);
                    setResult(null);
                    setError("");
                  }}
                  disabled={running}
                >
                  <option value="agent" disabled={!availability.agent}>
                    Hosted Agent
                  </option>
                  <option value="browser" disabled={!availability.browser}>
                    Hosted Browser
                  </option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                {operation === "browser"
                  ? "Public pages on approved domains only. No sign-in, purchases, or site changes."
                  : "One bounded task in an isolated sandbox. It cannot change external systems."}
              </p>
              <label className="block text-sm">
                What should it do?
                <textarea
                  className="mt-1 block min-h-28 w-full rounded-lg border bg-background p-2"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  maxLength={8000}
                  disabled={running}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-primary px-4 text-sm text-primary-foreground disabled:opacity-40"
                  disabled={running || !input.trim() || !availability[operation]}
                >
                  {running ? "Running task…" : "Run task"}
                </button>
                {running && (
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border px-4 text-sm"
                    onClick={() => active.current?.abort()}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {result?.ownerId === ownerId && (
            <div className="mt-4 rounded-lg border p-3" role="status" aria-live="polite">
              <h3 className="font-medium">Task result</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{result.text}</p>
              {typeof result.toolCalls === "number" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.toolCalls} browser action{result.toolCalls === 1 ? "" : "s"} completed.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
