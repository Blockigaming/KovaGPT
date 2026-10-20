import type { Dispatch, SetStateAction } from "react";
import { Lightbulb, ListChecks, PenLine, Sparkles } from "lucide-react";

const EMPTY_STATE_STARTERS = [
  {
    label: "Brainstorm ideas",
    prompt: "Help me brainstorm thoughtful ideas for ",
    icon: Lightbulb,
  },
  {
    label: "Make a plan",
    prompt: "Create a practical step-by-step plan for ",
    icon: ListChecks,
  },
  {
    label: "Improve writing",
    prompt: "Help me rewrite this clearly while preserving the meaning:\n\n",
    icon: PenLine,
  },
  {
    label: "Explore a topic",
    prompt: "Explain this topic clearly, including the most important context: ",
    icon: Sparkles,
  },
] as const;

/**
 * Empty-state prompt chips shown under the centered composer.
 * Visual treatment is owned by the parity CSS layer so light/dark and
 * mobile density stay consistent with the rest of the product.
 */
export function HomeChatStarters({ setInput }: { setInput: Dispatch<SetStateAction<string>> }) {
  return (
    <div className="kova-starter-grid">
      {EMPTY_STATE_STARTERS.map((starter) => {
        const Icon = starter.icon;
        return (
          <button
            key={starter.label}
            type="button"
            className="kova-starter-prompt"
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
            <span className="kova-starter-icon" aria-hidden="true">
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span>{starter.label}</span>
          </button>
        );
      })}
    </div>
  );
}
