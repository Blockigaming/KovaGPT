import { useEffect, useRef, type ReactNode, type Ref } from "react";
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
          .slice(0, 4)
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
  children: ReactNode;
}) {
  const greeting = useHomeGreeting(owner, firstName, chatId);
  const homeScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!owner) return;
    const section = homeScrollRef.current;
    if (!section) return;
    const phoneLayout = window.matchMedia(
      "(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)",
    );
    let following = true;
    const followLatest = () => {
      if (following && !phoneLayout.matches) section.scrollTop = section.scrollHeight;
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
    <HomeChatFrame
      scrollRef={homeScrollRef}
      headingId="chat-greeting"
      heading={
        <h1
          id="chat-greeting"
          className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
        >
          {greeting}
        </h1>
      }
      recentWork={
        conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null
      }
    >
      {children}
    </HomeChatFrame>
  );
}

export default HomeWelcome;
