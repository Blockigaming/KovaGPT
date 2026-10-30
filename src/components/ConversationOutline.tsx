import { useEffect, useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import type { Message } from "@/lib/chat-store";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

import { deriveConversationOutline, type OutlineSection } from "./conversation-outline-utils";

function OutlineNavigation({
  sections,
  activeId,
  onSelect,
}: {
  sections: OutlineSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Conversation outline" className="max-h-[min(60dvh,28rem)] overflow-y-auto p-1">
      <ol className="space-y-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <Button
              type="button"
              variant="ghost"
              aria-current={activeId === section.id ? "location" : undefined}
              onClick={() => onSelect(section.id)}
              className="h-auto min-h-9 w-full items-start justify-start gap-2 whitespace-normal rounded-lg py-2 text-left font-normal aria-[current=location]:bg-accent"
            >
              <span className="mt-0.5 text-xs text-muted-foreground">
                {section.role === "user" ? "You" : "K"}
              </span>
              <span className="line-clamp-2">{section.label}</span>
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ConversationOutline({ messages }: { messages: Message[] }) {
  const sections = useMemo(() => deriveConversationOutline(messages), [messages]);
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isMobile } = useLayout();

  useEffect(() => {
    const nodes = sections
      .map((section) => document.getElementById(`message-${section.id}`))
      .filter(Boolean) as HTMLElement[];
    if (!nodes.length || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = (visible?.target as HTMLElement | undefined)?.dataset.messageId;
        if (id) setActiveId(id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 5) return null;
  const select = (id: string) => {
    document
      .getElementById(`message-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
    setMobileOpen(false);
  };
  const trigger = (
    <Button
      type="button"
      variant="outline"
      onClick={isMobile ? () => setMobileOpen(true) : undefined}
      className="fixed right-3 top-20 z-20 gap-2 lg:right-6"
      aria-label="Open conversation outline"
    >
      <ListTree className="h-4 w-4" />
      <span className="hidden sm:inline">Outline</span>
    </Button>
  );
  if (isMobile)
    return (
      <>
        {trigger}
        <MobileBottomSheet
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title="Conversation outline"
        >
          <OutlineNavigation sections={sections} activeId={activeId} onSelect={select} />
        </MobileBottomSheet>
      </>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <div className="px-3 pb-1 pt-2 text-sm font-semibold">Conversation outline</div>
        <OutlineNavigation sections={sections} activeId={activeId} onSelect={select} />
      </PopoverContent>
    </Popover>
  );
}
