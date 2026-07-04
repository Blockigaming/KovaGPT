import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getOnboarding, saveOnboarding, skipOnboarding } from "@/lib/onboarding.functions";
import { useUser } from "@/components/auth/ClerkSafe";

const USES = [
  { id: "school", label: "School & studying" },
  { id: "writing", label: "Writing" },
  { id: "coding", label: "Coding" },
  { id: "research", label: "Research" },
  { id: "work", label: "Work" },
  { id: "email", label: "Email & organization" },
  { id: "creative", label: "Creativity" },
  { id: "planning", label: "Personal planning" },
];
const STYLES = [
  { id: "concise", label: "Concise" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];

export function OnboardingDialog() {
  const { isSignedIn, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [primaryUse, setPrimaryUse] = useState<string | null>(null);
  const [style, setStyle] = useState<string>("balanced");
  const [saving, setSaving] = useState(false);

  const fetchOnboarding = useServerFn(getOnboarding);
  const doSave = useServerFn(saveOnboarding);
  const doSkip = useServerFn(skipOnboarding);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchOnboarding();
        if (!cancelled && (!row || !row.completed)) setOpen(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, fetchOnboarding]);

  const finish = async () => {
    if (!primaryUse) return;
    setSaving(true);
    try {
      await doSave({ data: { primary_use: primaryUse, response_style: style } });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    try {
      await doSkip();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && skip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Welcome to KovaGPT" : "Response style"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "What will you mainly use KovaGPT for? This helps us personalize suggestions."
              : "Pick your default response style. You can change this anytime in Settings."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid grid-cols-2 gap-2 py-2">
            {USES.map((u) => (
              <button
                key={u.id}
                onClick={() => setPrimaryUse(u.id)}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition ${
                  primaryUse === u.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition ${
                  style === s.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={skip} disabled={saving}>
            Skip
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!primaryUse}>
              Continue
            </Button>
          ) : (
            <Button onClick={finish} disabled={saving}>
              {saving ? "Saving…" : "Finish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
