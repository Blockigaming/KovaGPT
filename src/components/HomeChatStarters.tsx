import { useEffect, useRef, type ReactNode } from "react";
import { ContinueWorking, HomeChatFrame } from "@/components/HomeChatFrame";
import type { Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";

export function HomeWelcome({
  home = true,
  owner,
  firstName,
  chatId,
  conversations,
  onSelect,
  children,
}: {
  home?: boolean;
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
    if (!home || !owner) return;
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
    let observerFrame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(observerFrame);
      observerFrame = window.requestAnimationFrame(followLatest);
    });
    observer.observe(section);
    if (section.firstElementChild) observer.observe(section.firstElementChild);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      section.addEventListener(event, stopFollowing, { passive: true });
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(observerFrame);
      observer.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        section.removeEventListener(event, stopFollowing);
      }
    };
  }, [home, owner, chatId, conversations.length]);

  return (
    <HomeChatFrame
      home={home}
      scrollRef={homeScrollRef}
      headingId="chat-greeting"
      heading={greeting}
      recentWork={
        home && conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null
      }
    >
      {children}
    </HomeChatFrame>
  );
}

export default HomeWelcome;
