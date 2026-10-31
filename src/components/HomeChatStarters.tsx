import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";
import { Columns2, FileText, PenLine } from "lucide-react";

const EMPTY_STATE_STARTERS = [
  {
    label: "Write something",
    prompt: "Help me write ",
    icon: PenLine,
  },
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
 * ChatGPT's vertical suggested-prompt rows beneath the empty composer.
 * A selection only fills an empty draft; it never submits or replaces work.
 */
export function HomeChatStarters({ setInput }: { setInput: Dispatch<SetStateAction<string>> }) {
  return (
    <div
      className="spec400-starter-actions"
      aria-label="Start a draft"
      data-ui-reference="chatgpt-suggested-prompts"
    >
      {EMPTY_STATE_STARTERS.map(({ label, prompt, icon: Icon }) => (
        <button
          key={label}
          type="button"
          className="spec400-toolbar-button kova-home-starter"
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
          <span className="kova-home-starter-icon">
            <Icon aria-hidden="true" />
          </span>
          <span className="kova-home-starter-copy">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function ContinueWorking({
  conversations,
  onSelect,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
}) {
  return (
    <section className="spec400-recent-work" aria-labelledby="continue-working-heading">
      <h2 id="continue-working-heading">Continue working</h2>
      <ul>
        {[...conversations]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 3)
          .map((conversation) => (
            <li key={conversation.id}>
              <button type="button" onClick={() => onSelect(conversation.id)}>
                <strong>{conversation.title}</strong>
                <time dateTime={new Date(conversation.updatedAt).toISOString()}>
                  Updated{" "}
                  {new Date(conversation.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

export function HomeWelcome({
  owner,
  firstName,
  chatId,
  conversations,
  onSelect,
  setInput,
  children,
}: {
  owner: string | null;
  firstName?: string | null;
  chatId: string | null;
  conversations: Conversation[];
  onSelect: (id: string) => void;
  setInput: Dispatch<SetStateAction<string>>;
  children: ReactNode;
}) {
  const greeting = useHomeGreeting(owner, firstName, chatId);
  return (
    <section
      className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
      data-ui-reference="grok.prompt-first-home"
      aria-labelledby="chat-greeting"
    >
      <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
        <div
          data-ui-reference="claude.greeting"
          className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6"
        >
          <h1
            id="chat-greeting"
            className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
          >
            {greeting}
          </h1>
        </div>
        <div className="kova-empty-composer">{children}</div>
        <HomeChatStarters setInput={setInput} />
        {conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null}
      </div>
    </section>
  );
}

export default HomeWelcome;
