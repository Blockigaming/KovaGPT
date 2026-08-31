import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { updateScheduledTask, type ScheduledTask } from "@/lib/scheduled-tasks.functions";

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function editableRunAt(task: ScheduledTask) {
  return task.next_run_at ?? task.run_at;
}

export function ScheduledTaskEditor({
  task,
  executionAvailable,
  onUpdated,
}: {
  task: ScheduledTask;
  executionAvailable: boolean;
  onUpdated: (task: ScheduledTask) => void;
}) {
  const update = useServerFn(updateScheduledTask);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [when, setWhen] = useState(() => toLocalInput(editableRunAt(task)));
  const [repeat, setRepeat] = useState<ScheduledTask["repeat"]>(task.repeat);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const reset = () => {
    setTitle(task.title);
    setPrompt(task.prompt);
    setWhen(toLocalInput(editableRunAt(task)));
    setRepeat(task.repeat);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!executionAvailable || !title.trim() || !prompt.trim() || !when) return;
    setSaving(true);
    try {
      const next = await update({
        data: {
          id: task.id,
          title: title.trim(),
          prompt: prompt.trim(),
          run_at: new Date(when).toISOString(),
          repeat,
          time_zone: timeZone,
        },
      });
      onUpdated(next);
      setOpen(false);
      toast.success(
        task.status === "running"
          ? "Task updated; the active occurrence will stop and the new schedule will continue"
          : "Task updated",
      );
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Scheduled task could not be updated");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={!executionAvailable}
        className="p-2 rounded-md hover:bg-accent transition disabled:opacity-40"
        aria-label="Edit scheduled task"
        title={executionAvailable ? "Edit" : "Editing unavailable while scheduled execution is disabled"}
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
          <div
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`scheduled-task-edit-${task.id}`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id={`scheduled-task-edit-${task.id}`} className="font-display text-lg font-semibold">
                  Edit scheduled task
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Times use {timeZone}. Editing an active run requests cancellation before the new schedule is used.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent"
                aria-label="Close editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={save} className="space-y-4">
              <label className="block text-xs font-medium text-muted-foreground">
                Title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                  className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>

              <label className="block text-xs font-medium text-muted-foreground">
                What should Kova do?
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={4000}
                  required
                  className="mt-1 min-h-28 w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-muted-foreground">
                  When
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(event) => setWhen(event.target.value)}
                    required
                    className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Repeat
                  <select
                    value={repeat}
                    onChange={(event) => setRepeat(event.target.value as ScheduledTask["repeat"])}
                    className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  >
                    <option value="none">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
