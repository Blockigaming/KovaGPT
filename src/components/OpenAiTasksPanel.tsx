import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  loadOpenAiTaskAvailability,
  submitOpenAiTask,
  type OpenAiTaskAvailability,
  type OpenAiTaskOperation,
} from "@/lib/openai-task-client.mjs";
import { authFetch } from "@/lib/auth-fetch";

export function OpenAiTasksPanel({ ownerId }: { ownerId: string | null }) {
  const [availability, setAvailability] = useState<OpenAiTaskAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [operation, setOperation] = useState<OpenAiTaskOperation>("agent");
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
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
    setInput("");
    setQuestion("");
    setRunning(false);
    setChecking(false);
    setAvailability(null);
    if (!ownerId) return;
    const controller = new AbortController();
    setChecking(true);
    void loadOpenAiTaskAvailability(ownerId, { signal: controller.signal, fetchImpl: authFetch })
      .then((next) => {
        if (owner.current === ownerId && !controller.signal.aborted) {
          setAvailability(next);
          setOperation(
            next.agent
              ? "agent"
              : next.browser
                ? "browser"
                : next.decisions
                  ? "decisions"
                  : "moderation",
          );
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
    if (
      !ownerId ||
      running ||
      active.current ||
      !availability?.[operation] ||
      !input.trim() ||
      (operation === "decisions" && !question.trim())
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const answer = await submitOpenAiTask(
        {
          ownerId,
          operation,
          input,
          requestId: crypto.randomUUID(),
          ...(operation === "decisions" ? { question } : {}),
        },
        { signal: controller.signal, fetchImpl: authFetch },
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
        Run a hosted Agent or Browser task, evaluate a yes/no question, or check text for content
        categories. Results are separate from saved Work runs.
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
          {availability?.configured &&
            !availability.agent &&
            !availability.browser &&
            !availability.decisions &&
            !availability.moderation && (
              <p className="mt-3 text-sm" role="status">
                No tasks are available for your account right now.
              </p>
            )}
          {availability?.configured &&
            (availability.agent ||
              availability.browser ||
              availability.decisions ||
              availability.moderation) && (
              <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3">
                <label className="block text-sm">
                  Task type
                  <Select
                    value={operation}
                    onValueChange={(value) => {
                      setOperation(value as OpenAiTaskOperation);
                      setResult(null);
                      setError("");
                    }}
                    disabled={running}
                  >
                    <SelectTrigger aria-label="Task type" className="mt-1 min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent" disabled={!availability.agent}>
                        Hosted Agent
                      </SelectItem>
                      <SelectItem value="browser" disabled={!availability.browser}>
                        Hosted Browser
                      </SelectItem>
                      <SelectItem value="decisions" disabled={!availability.decisions}>
                        Decisions
                      </SelectItem>
                      <SelectItem value="moderation" disabled={!availability.moderation}>
                        Content moderation
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <p className="text-xs text-muted-foreground">
                  {operation === "browser"
                    ? "Public pages on approved domains only. No sign-in, purchases, or site changes."
                    : operation === "decisions"
                      ? "Evaluate a yes/no question against the supplied text. The probability is a model estimate."
                      : operation === "moderation"
                        ? "Check text for potentially harmful content categories. Results support your review."
                        : "One bounded task in an isolated sandbox. It cannot change external systems."}
                </p>
                {operation === "decisions" && (
                  <label className="block text-sm">
                    Yes/no question
                    <Input
                      className="mt-1 block w-full border bg-background"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={1000}
                      disabled={running}
                    />
                  </label>
                )}
                <label className="block text-sm">
                  {operation === "decisions"
                    ? "Text to evaluate"
                    : operation === "moderation"
                      ? "Text to check"
                      : "What should it do?"}
                  <Textarea
                    className="mt-1 block min-h-28 w-full border bg-background"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    maxLength={8000}
                    disabled={running}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="default"
                    type="submit"
                    className="bg-primary text-sm text-primary-foreground disabled:opacity-40"
                    disabled={
                      running ||
                      !input.trim() ||
                      !availability[operation] ||
                      (operation === "decisions" && !question.trim())
                    }
                  >
                    {running ? "Running task…" : "Run task"}
                  </Button>
                  {running && (
                    <Button
                      variant="outline"
                      type="button"
                      className="border text-sm"
                      onClick={() => active.current?.abort()}
                    >
                      Cancel
                    </Button>
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
