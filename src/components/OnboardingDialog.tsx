import { useEffect, useMemo, useState } from "react";
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
import { Sparkles } from "lucide-react";

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

// Starter prompts tailored to each primary use. On step 3 we show a rotating
// pool so returning users see fresh ideas; clicking one seeds the composer
// draft so the prompt is waiting for them when the dialog closes.
const STARTERS: Record<string, string[]> = {
  school: [
    "Explain photosynthesis like I'm 12",
    "Quiz me on the causes of World War I",
    "Summarize the key ideas in chapter 3 of my textbook",
    "Help me outline an essay on climate change",
    "Break down this calculus problem step by step",
    "Make flashcards from these lecture notes",
  ],
  writing: [
    "Rewrite this paragraph so it sounds more confident",
    "Give me 5 catchy blog title ideas about productivity",
    "Draft a warm follow-up email to a client",
    "Improve the flow of this cover letter",
    "Suggest a compelling opening line for my essay",
    "Turn these bullets into a polished LinkedIn post",
  ],
  coding: [
    "Explain what this error message means and how to fix it",
    "Write a Python script that renames files by date",
    "Review this function and suggest improvements",
    "Help me design a REST API for a todo app",
    "Convert this SQL query into a Prisma call",
    "What is the best way to debounce a React input?",
  ],
  research: [
    "Compare the pros and cons of solar vs wind energy",
    "Give me a literature summary on remote work productivity",
    "What are the leading theories on consciousness in 2025?",
    "Help me build a research question about urban housing",
    "Find counterarguments to this claim so I can strengthen it",
    "Summarize the latest thinking on gut microbiome and mood",
  ],
  work: [
    "Turn this meeting transcript into action items",
    "Help me prep for a 1:1 with my manager",
    "Draft a project kickoff doc for a new launch",
    "Rewrite this Slack message so it lands better",
    "Give me an agenda for a 30-minute team sync",
    "Summarize this doc into 5 bullet points I can share",
  ],
  email: [
    "Draft a polite decline to a meeting invite",
    "Summarize my unread emails from this week",
    "Write a professional out-of-office reply",
    "Help me follow up on an unpaid invoice",
    "Reply to this customer complaint with empathy",
    "Draft a cold email to introduce myself to a mentor",
  ],
  creative: [
    "Brainstorm 10 unique gift ideas under $50",
    "Give me story hooks for a short sci-fi piece",
    "Help me name a coffee brand for morning routines",
    "Write a poem about a rainy Sunday",
    "Suggest a color palette for a cozy reading room",
    "Design a plot twist for my mystery novel",
  ],
  planning: [
    "Plan a 5-day trip to Lisbon on a tight budget",
    "Help me build a morning routine I'll actually stick to",
    "Design a weekly meal plan for a busy week",
    "Break down moving apartments into a checklist",
    "Suggest a workout split for 4 days a week",
    "Plan a low-key birthday dinner for 6 people",
  ],
};

function pickStarters(useId: string | null, count = 4): string[] {
  const pool = STARTERS[useId ?? "work"] ?? STARTERS.work;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function OnboardingDialog() {
  const { isSignedIn, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [primaryUse, setPrimaryUse] = useState<string | null>(null);
  const [style, setStyle] = useState<string>("balanced");
  const [saving, setSaving] = useState(false);
  const [rotateKey, setRotateKey] = useState(0);

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

  const starters = useMemo(
    () => pickStarters(primaryUse),
    // Rotate when the user asks for fresh ideas or picks a new "primary use".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryUse, rotateKey],
  );

  const persistOnboarding = async () => {
    if (!primaryUse) return;
    await doSave({ data: { primary_use: primaryUse, response_style: style } });
  };

  const finish = async (starter?: string) => {
    if (!primaryUse) return;
    setSaving(true);
    try {
      await persistOnboarding();
      if (starter) {
        try {
          localStorage.setItem("kova-draft:__new__", starter);
        } catch {
          /* ignore */
        }
      }
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

  const titles: Record<number, { title: string; desc: string }> = {
    1: {
      title: "Welcome to KovaGPT",
      desc: "What will you mainly use KovaGPT for? This helps us personalize suggestions.",
    },
    2: {
      title: "Response style",
      desc: "Pick your default. You can change this anytime in Settings.",
    },
    3: {
      title: "Try a starter prompt",
      desc: "Tap one to open KovaGPT with it pre-filled, or skip and jump straight in.",
    },
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && skip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[step].title}</DialogTitle>
          <DialogDescription>{titles[step].desc}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
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
        )}

        {step === 2 && (
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

        {step === 3 && (
          <div className="flex flex-col gap-2 py-2">
            {starters.map((s) => (
              <button
                key={s}
                onClick={() => finish(s)}
                disabled={saving}
                className="group rounded-xl border border-border px-3 py-2.5 text-sm text-left transition hover:bg-muted hover:border-muted-foreground/40 disabled:opacity-60"
              >
                <span className="flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 text-muted-foreground group-hover:text-foreground transition" />
                  <span className="flex-1">{s}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRotateKey((n) => n + 1)}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground transition text-left"
            >
              Show me different ideas
            </button>
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
          ) : step === 2 ? (
            <Button onClick={() => setStep(3)} disabled={saving}>
              Continue
            </Button>
          ) : (
            <Button onClick={() => finish()} disabled={saving}>
              {saving ? "Saving…" : "Start chatting"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
