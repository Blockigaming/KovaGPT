import type { Dispatch, SetStateAction } from "react";
import { Lightbulb, ListChecks, PenLine, Sparkles } from "lucide-react";

const EMPTY_STATE_STARTERS = [
  {
    label: "Brainstorm ideas",
    description: "Find a fresh angle",
    prompt: "Help me brainstorm thoughtful ideas for ",
    icon: Lightbulb,
  },
  {
    label: "Make a plan",
    description: "Turn goals into next steps",
    prompt: "Create a practical step-by-step plan for ",
    icon: ListChecks,
  },
  {
    label: "Improve writing",
    description: "Make every word count",
    prompt: "Help me rewrite this clearly while preserving the meaning:\n\n",
    icon: PenLine,
  },
  {
    label: "Explore a topic",
    description: "Understand the essentials",
    prompt: "Explain this topic clearly, including the most important context: ",
    icon: Sparkles,
  },
] as const;

export function HomeChatStarters({ setInput }: { setInput: Dispatch<SetStateAction<string>> }) {
  return (
    <div className="kova-starter-grid mx-auto grid w-full max-w-[48rem] grid-cols-2 gap-2 px-1 pt-2 sm:px-2">
      {EMPTY_STATE_STARTERS.map((starter) => {
        const Icon = starter.icon;
        return (
          <button
            key={starter.label}
            type="button"
            className="kova-starter-prompt group flex min-h-14 items-center gap-2.5 rounded-xl border border-border px-3 text-left"
            aria-label={`Start with ${starter.label}`}
            onClick={() => {
              setInput((current) => (current.trim() ? current : starter.prompt));
              window.requestAnimationFrame(() => {
                document
                  .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
                  ?.focus({ preventScroll: true });
              });
            }}
          >
            <span className="kova-starter-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
              <Icon className="h-4 w-4" />
            </span>
            <span className="kova-starter-copy min-w-0 text-sm text-foreground">
              <strong>{starter.label}</strong>
              <small>{starter.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
