import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, ImageIcon, FolderKanban, LibraryBig } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
import { usePhoneLayout } from "@/hooks/use-mobile";
import type { Conversation } from "@/lib/chat-store";
import { useHomeGreeting } from "@/lib/use-home-greeting";

const destinations = [
  { to: "/images", label: "Images", icon: ImageIcon },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/library", label: "Library", icon: LibraryBig },
] as const;

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
                <ArrowUpRight
                  className="kova-phone-resume-icon hidden h-4 w-4"
                  aria-hidden="true"
                />
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
  children: ReactNode;
}) {
  const greeting = useHomeGreeting(owner, firstName, chatId);
  const phone = usePhoneLayout();
  const homeScrollRef = useRef<HTMLElement>(null);
  const composer = (
    <div key="composer" className="kova-empty-composer">
      {children}
    </div>
  );

  useEffect(() => {
    if (!owner || phone || typeof ResizeObserver === "undefined") return;
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
  }, [owner, chatId, conversations.length, phone]);

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
          className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6"
        >
          <span className="kova-phone-greeting-mark hidden" aria-hidden="true">
            <NovaLogo mark decorative className="h-9 w-9" />
          </span>
          <h1
            id="chat-greeting"
            className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
          >
            {greeting}
          </h1>
        </div>
        {!phone && composer}
        {owner ? (
          <nav className="kova-phone-home-destinations hidden" aria-label="Chat shortcuts">
            {destinations.map(({ to, label, icon: Icon }) => (
              <Link to={to} key={to}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        {conversations.length ? (
          <ContinueWorking conversations={conversations} onSelect={onSelect} />
        ) : null}
        {phone && composer}
      </div>
    </section>
  );
}

export default HomeWelcome;
