import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createWorkRun, type WorkRun } from "@/lib/work.functions";

export function WorkRunComposer({ onCreated }: { onCreated: (run: WorkRun) => void }) {
  const create = useServerFn(createWorkRun);
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = objective.trim();
    if (!value || submitting) return;

    setSubmitting(true);
    try {
      const run = await create({
        data: {
          objective: value,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      onCreated(run);
      setObjective("");
      setOpen(false);
      toast.success("Work run queued");
    } catch {
      toast.error("Work could not be started. Check your plan and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" />
        New Work
      </button>
    );
  }

  return (
    <section className="rounded-2xl border bg-background p-4" aria-label="Create Work run">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Start model-only Work</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This source stage supports durable reasoning and writing. Browser and external tool
            actions remain unavailable until their isolated worker is verified.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-muted"
          aria-label="Close Work composer"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label className="block text-sm font-medium" htmlFor="work-objective">
          Objective
        </label>
        <textarea
          id="work-objective"
          className="min-h-36 w-full resize-y rounded-xl border bg-card px-3 py-2 text-sm"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          maxLength={12000}
          placeholder="Describe the result Work should prepare."
          disabled={submitting}
          required
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {objective.length.toLocaleString()} / 12,000
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-10 rounded-full border px-4 text-sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
              disabled={!objective.trim() || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Start Work
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
