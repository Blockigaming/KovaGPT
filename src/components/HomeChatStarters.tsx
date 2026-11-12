import { useEffect, useRef, type ReactNode } from "react";
import { loadArchivedConversations, type Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";
import { ChatGuidedTour } from "@/components/ChatGuidedTour";
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
          .slice(0, 2)
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
  historyReady,
  historyComplete,
  onSelect,
  children,
}: {
  owner: string | null;
  firstName?: string | null;
  chatId: string | null;
  conversations: Conversation[];
  historyReady: boolean;
  historyComplete: boolean;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const hasHistory = Boolean(
    owner &&
    historyReady &&
    (conversations.some((conversation) => conversation.messages.length > 0) ||
      loadArchivedConversations(owner).some((conversation) => conversation.messages.length > 0)),
  );
  const greeting = useHomeGreeting(hasHistory ? owner : null, firstName, chatId);
  const firstConversation = Boolean(owner && historyReady && historyComplete && !hasHistory);
  const homeScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!owner) return;
    const section = homeScrollRef.current;
    if (!section) return;
    let following = true;
    const followLatest = () => {
      if (following) section.scrollTop = section.scrollHeight;
    };
    const stopFollowing = () => {
      following = false;
    };
    const frame = window.requestAnimationFrame(followLatest);
    // Composer measurement and font loading can change the initial content height.
    // Follow those changes until the user starts navigating the welcome surface.
    const observer = new ResizeObserver(followLatest);
    observer.observe(section);
    if (section.firstElementChild) observer.observe(section.firstElementChild);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      section.addEventListener(event, stopFollowing, { passive: true });
    }
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        section.removeEventListener(event, stopFollowing);
      }
    };
  }, [owner, chatId, conversations.length]);

  return (
    <section
      ref={homeScrollRef}
      className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
      data-ui-reference="grok.prompt-first-home"
      aria-labelledby="chat-greeting"
    >
      <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
        <div
          data-ui-reference="claude.greeting"
          className="kova-greeting relative mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6"
        >
          <h1
            id="chat-greeting"
            data-kova-notice-id={
              hasHistory && greeting.startsWith("Welcome back") ? "welcome_back" : undefined
            }
            className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
          >
            {greeting}
          </h1>
          {firstConversation && (
            <p
              data-kova-notice-id="first_conversation"
              className="absolute inset-x-0 top-full truncate px-2 text-center text-xs leading-4 text-muted-foreground"
            >
              Start your first conversation below.
            </p>
          )}
        </div>
        <div className="kova-empty-composer relative">
          {children}
          {firstConversation && !conversations.length && (
            <div className="absolute inset-x-0 top-full flex justify-center pt-1">
              <ChatGuidedTour key={owner} />
            </div>
          )}
        </div>
        {conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null}
      </div>
    </section>
  );
}

export default HomeWelcome;
