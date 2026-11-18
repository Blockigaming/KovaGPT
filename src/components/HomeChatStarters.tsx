import { useEffect, useRef, type ReactNode } from "react";
import { ContinueWorking, HomeChatFrame } from "@/components/HomeChatFrame";
import type { Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";

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
