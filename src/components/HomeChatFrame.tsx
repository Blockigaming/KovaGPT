import { useId, type ReactNode, type Ref } from "react";
import { NovaLogo } from "@/components/NovaLogo";
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
    <section className="spec400-recent-work kova-desktop-recent-work" aria-labelledby={headingId}>
      <h2 id={headingId}>Continue working</h2>
      <ul>
        {[...conversations]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
          .map((conversation) => (
            <li key={conversation.id}>
              <button type="button" onClick={() => onSelect(conversation.id)}>
                <strong title={conversation.title}>{conversation.title}</strong>
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
  home = true,
  scrollRef,
  bottomRef,
  heading,
  headingId,
  recentWork,
  children,
}: {
  home?: boolean;
  scrollRef?: Ref<HTMLElement>;
  bottomRef?: Ref<HTMLSpanElement>;
  heading: string;
  headingId?: string;
  recentWork?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      ref={scrollRef}
      className={
        home ? "kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6" : "contents"
      }
      data-ui-reference={home ? "grok.prompt-first-home" : undefined}
      aria-labelledby={home ? headingId : undefined}
    >
      <div
        className={
          home
            ? "kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10"
            : "contents"
        }
      >
        {home && (
          <div
            data-ui-reference="claude.greeting"
            className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6"
          >
            <h1
              id={headingId}
              className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
            >
              <span className="kova-home-greeting-text">{heading}</span>
              <NovaLogo mark className="kova-home-welcome-logo" />
            </h1>
          </div>
        )}
        <div className={home ? "kova-empty-composer" : "spec400-composer-dock relative shrink-0"}>
          {children}
        </div>
        {recentWork}
        {bottomRef && <span ref={bottomRef} aria-hidden="true" className="-mt-px h-px shrink-0" />}
      </div>
    </section>
  );
}
