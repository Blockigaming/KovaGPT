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
    let frame: number | null = null;
    const queueFollowLatest = () => {
      if (!following || phoneLayout.matches || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (following && !phoneLayout.matches) section.scrollTop = section.scrollHeight;
      });
    };
    const stopFollowing = () => {
      following = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    queueFollowLatest();
    // Composer measurement and font loading can change the initial content height.
    // Never write scroll geometry during ResizeObserver delivery.
    const observer = new ResizeObserver(queueFollowLatest);
    observer.observe(section);
    if (section.firstElementChild) observer.observe(section.firstElementChild);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      section.addEventListener(event, stopFollowing, { passive: true });
    }
    return () => {
      stopFollowing();
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
