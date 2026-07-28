import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, WandSparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AutomationDraft = {
  title: string;
  prompt: string;
  runAt: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
};
export function AutomationBuilder({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: AutomationDraft) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [conditions, setConditions] = useState("");
  const [runAt, setRunAt] = useState("");
  const [repeat, setRepeat] = useState<AutomationDraft["repeat"]>("none");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = useMemo(
    () =>
      `${instruction.trim()}${conditions.trim() ? `\n\nOnly complete this task when: ${conditions.trim()}` : ""}`,
    [conditions, instruction],
  );
  const valid =
    step === 0 ? Boolean(title.trim() && instruction.trim()) : step === 1 ? Boolean(runAt) : true;
  const summary = `${repeat === "none" ? "Once" : repeat[0].toUpperCase() + repeat.slice(1)}, starting ${runAt ? new Date(runAt).toLocaleString() : "when selected"}. KovaGPT will ${instruction.trim() || "perform the task"} and save the truthful result or failure in Task history.`;
  const reset = () => {
    setStep(0);
    setTitle("");
    setInstruction("");
    setConditions("");
    setRunAt("");
    setRepeat("none");
    setError(null);
  };
  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), prompt, runAt: new Date(runAt).toISOString(), repeat });
      reset();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Automation could not be created");
    } finally {
      setCreating(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5" /> Automation Builder
          </DialogTitle>
          <DialogDescription>
            Build a scheduled workflow using capabilities supported by Scheduled Tasks.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-1 flex gap-1" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((value) => (
            <span
              key={value}
              className={`h-1.5 flex-1 rounded-full ${value <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        {step === 0 && (
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Automation name
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
                placeholder="Weekly project briefing"
              />
            </label>
            <label className="block text-sm font-medium">
              Action
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                maxLength={3500}
                className="mt-1.5 min-h-28 w-full rounded-xl border border-border bg-background p-3"
                placeholder="Summarize the progress and open questions in my project notes."
              />
            </label>
            <label className="block text-sm font-medium">
              Condition <span className="font-normal text-muted-foreground">(optional)</span>
              <input
                value={conditions}
                onChange={(event) => setConditions(event.target.value)}
                maxLength={400}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
                placeholder="there are new notes since the prior run"
              />
            </label>
            <div className="rounded-xl bg-muted/60 p-3 text-sm">
              <strong>Source:</strong> task instruction and the context available to the
              scheduled-task runner. Connectors are not added automatically.
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Start date and time
              <input
                autoFocus
                type="datetime-local"
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
              />
            </label>
            <label className="block text-sm font-medium">
              Recurrence
              <select
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as AutomationDraft["repeat"])}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
              >
                <option value="none">Run once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>Destination:</strong> Scheduled Task history. A completed result is never
              claimed until the runner records it.
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Review automation</h3>
            <div className="rounded-xl border border-border p-4">
              <div className="font-medium">{title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
              {conditions.trim() && (
                <p className="mt-2 text-sm">
                  <strong>Condition:</strong> {conditions}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              You can pause, resume, retry, or delete this automation from Scheduled Tasks.
            </p>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="mt-2 flex justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep((value) => value - 1))}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 hover:bg-accent"
          >
            {step > 0 && <ArrowLeft className="h-4 w-4" />}
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < 2 ? (
            <button
              type="button"
              disabled={!valid}
              onClick={() => setStep((value) => value + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={creating}
              onClick={submit}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {creating ? "Creating…" : "Create automation"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
