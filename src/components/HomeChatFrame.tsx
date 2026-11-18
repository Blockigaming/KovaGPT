import { useId, type ReactNode, type Ref } from "react";
import type { Conversation } from "@/lib/chat-store";

export function ContinueWorking({
  conversations,
  onSelect,
  limit = 4,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  limit?: number;
}) {
  const headingId = useId();
  return (
    <section className="spec400-recent-work" aria-labelledby={headingId}>
      <h2 id={headingId}>Continue working</h2>
      <ul>
        {[...conversations]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
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

export function HomeChatFrame({
  scrollRef,
  heading,
  headingId,
  recentWork,
  children,
}: {
  scrollRef?: Ref<HTMLElement>;
  heading: ReactNode;
  headingId?: string;
  recentWork?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      ref={scrollRef}
      className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
      data-ui-reference="grok.prompt-first-home"
      aria-labelledby={headingId}
    >
      <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
        <div
          data-ui-reference="claude.greeting"
          className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6"
        >
          {heading}
        </div>
        <div className="kova-empty-composer">{children}</div>
        {recentWork}
      </div>
    </section>
  );
}
