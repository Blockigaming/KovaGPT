import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
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
import { saveDraft } from "@/lib/chat-store";
import { ArrowLeft, Check, Sparkles } from "lucide-react";

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
  { id: "concise", label: "Concise", hint: "Short and direct" },
  { id: "balanced", label: "Balanced", hint: "Clear with useful context" },
  { id: "detailed", label: "Detailed", hint: "Thorough and comprehensive" },
] as const;

export type OnboardingResponseLength = "short" | "medium" | "long";

export interface OnboardingCompletion {
  ownerId: string;
  responseLength: OnboardingResponseLength;
  starter?: string;
}

const RESPONSE_LENGTH_BY_STYLE: Record<(typeof STYLES)[number]["id"], OnboardingResponseLength> = {
  concise: "short",
  balanced: "medium",
  detailed: "long",
};

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
    "What are the leading theories on consciousness?",
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

export function OnboardingDialog({
  onStarterSelected,
  onResponseLengthChange,
  onCompletion,
}: {
  onStarterSelected?: (starter: string) => void;
  onResponseLengthChange?: (responseLength: OnboardingResponseLength) => void;
  onCompletion?: (completion: OnboardingCompletion) => void;
} = {}) {
  const navigate = useNavigate();
  const { isSignedIn, isLoaded, user } = useUser();
  const ownerIdRef = useRef(user?.id ?? null);
  ownerIdRef.current = user?.id ?? null;
  const operationRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [primaryUse, setPrimaryUse] = useState<string | null>(null);
  const [style, setStyle] = useState<(typeof STYLES)[number]["id"]>("balanced");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState(0);

  const fetchOnboarding = useServerFn(getOnboarding);
  const doSave = useServerFn(saveOnboarding);
  const doSkip = useServerFn(skipOnboarding);

  useEffect(() => {
    operationRef.current += 1;
    setOpen(false);
    setStep(1);
    setPrimaryUse(null);
    setStyle("balanced");
    setSaving(false);
    setSaveError(null);
    setRotateKey(0);
  }, [user?.id]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user?.id) return;
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
  }, [isLoaded, isSignedIn, user?.id, fetchOnboarding]);

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
    if (!primaryUse || !user?.id) return;
    const initiatingOwnerId = user.id;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setSaving(true);
    setSaveError(null);
    try {
      await persistOnboarding();
      if (ownerIdRef.current !== initiatingOwnerId || operationRef.current !== operation) return;
      if (starter) {
        try {
          saveDraft(initiatingOwnerId, null, starter);
        } catch {
          /* The in-memory home composer can still receive the starter. */
        }
      }
      const responseLength = RESPONSE_LENGTH_BY_STYLE[style];
      onCompletion?.({ ownerId: initiatingOwnerId, responseLength, starter });
      onResponseLengthChange?.(responseLength);
      if (starter) {
        onStarterSelected?.(starter);
      }
      setOpen(false);
      await navigate({ to: "/" });
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
          ?.focus({ preventScroll: true });
      });
    } catch {
      if (ownerIdRef.current === initiatingOwnerId && operationRef.current === operation) {
        setSaveError("We couldn't save your choices. Try again or skip setup for now.");
      }
    } finally {
      if (ownerIdRef.current === initiatingOwnerId && operationRef.current === operation) {
        setSaving(false);
      }
    }
  };

  const skip = async () => {
    // Dismissing onboarding must never trap a signed-in user behind a failed
    // best-effort persistence request. Keep the completion write, but release
    // the interface immediately and let a later visit retry if necessary.
    const initiatingOwnerId = ownerIdRef.current;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setOpen(false);
    setSaving(true);
    try {
      await doSkip();
    } catch {
      /* The dialog is already released; a future visit can retry persistence. */
    } finally {
      if (ownerIdRef.current === initiatingOwnerId && operationRef.current === operation) {
        setOpen(false);
        setSaving(false);
      }
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
      <DialogContent className="gap-0 overflow-y-auto p-0 sm:max-w-[30rem] [&>div[aria-hidden]]:mt-2">
        <div className="border-b border-border/60 pb-4 pl-5 pr-16 pt-5 sm:pl-6 sm:pr-16">
          <div className="mb-4 flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-muted-foreground">Step {step} of 3</span>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={1}
              aria-valuemax={3}
              aria-valuenow={step}
              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
          </div>
          <DialogHeader>
            <DialogTitle>{titles[step].title}</DialogTitle>
            <DialogDescription>{titles[step].desc}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5 py-4 sm:px-6">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-2">
              {USES.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  aria-pressed={primaryUse === u.id}
                  onClick={() => {
                    setPrimaryUse(u.id);
                    setSaveError(null);
                  }}
                  className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    primaryUse === u.id
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/70 hover:border-border hover:bg-muted/70"
                  }`}
                >
                  <span>{u.label}</span>
                  {primaryUse === u.id ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-2">
              {STYLES.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={style === s.id}
                  onClick={() => {
                    setStyle(s.id);
                    setSaveError(null);
                  }}
                  className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    style === s.id
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 hover:border-border hover:bg-muted/70"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium text-foreground">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                  {style === s.id ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-2 py-2">
              {starters.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => finish(s)}
                  disabled={saving}
                  className="group min-h-12 rounded-xl border border-border/70 px-3 py-2.5 text-left text-sm transition hover:border-border hover:bg-muted/70 disabled:opacity-60"
                >
                  <span className="flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 text-muted-foreground group-hover:text-foreground transition" />
                    <span className="flex-1">{s}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setRotateKey((n) => n + 1);
                  setSaveError(null);
                }}
                className="mt-1 min-h-11 rounded-lg px-2 text-left text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
              >
                Show me different ideas
              </button>
            </div>
          )}

          {saveError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {saveError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/60 bg-muted/20 px-5 py-4 sm:justify-between sm:px-6">
          <Button
            variant="ghost"
            onClick={() => {
              setSaveError(null);
              if (step === 1) void skip();
              else setStep((current) => Math.max(1, current - 1));
            }}
            disabled={saving}
          >
            {step === 1 ? null : <ArrowLeft className="mr-1.5 h-4 w-4" />}
            {step === 1 ? "Skip for now" : "Back"}
          </Button>
          {step === 1 ? (
            <Button
              onClick={() => {
                setSaveError(null);
                setStep(2);
              }}
              disabled={!primaryUse}
            >
              Continue
            </Button>
          ) : step === 2 ? (
            <Button
              onClick={() => {
                setSaveError(null);
                setStep(3);
              }}
              disabled={saving}
            >
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
