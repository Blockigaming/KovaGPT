import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";
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
        {conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null}
      </div>
    </section>
  );
}

export default HomeWelcome;
