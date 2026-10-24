import type { Dispatch, SetStateAction } from "react";
import { Columns2, FileText, PenLine } from "lucide-react";

const EMPTY_STATE_STARTERS = [
  { label: "Write something", prompt: "Help me write ", icon: PenLine },
  {
    label: "Summarize a file",
    prompt: "Summarize the file I attach, highlighting its key points and any important caveats.",
    icon: FileText,
  },
  {
    label: "Compare options",
    prompt:
      "Compare these options, including their benefits, drawbacks, and important trade-offs:\n\n",
    icon: Columns2,
  },
] as const;

/**
 * Empty-state prompt chips shown under the centered composer.
 * Visual treatment is owned by the parity CSS layer so light/dark and
 * mobile density stay consistent with the rest of the product.
 */
export function HomeChatStarters({ setInput }: { setInput: Dispatch<SetStateAction<string>> }) {
  return (
    <div className="spec400-starter-actions" aria-label="Start a draft">
      {EMPTY_STATE_STARTERS.map(({ label, prompt, icon: Icon }) => (
        <button
          key={label}
          type="button"
          className="spec400-toolbar-button"
          aria-label={`Start with ${label}`}
          onClick={() => {
            // A starter never overwrites work already entered and never submits.
            setInput((current) => (current.trim() ? current : prompt));
            window.requestAnimationFrame(() =>
              document
                .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
                ?.focus({ preventScroll: true }),
            );
          }}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
