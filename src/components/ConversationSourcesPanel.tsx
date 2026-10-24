import { useMemo, type ReactNode } from "react";
import { ConversationSourcesView } from "./ConversationSourcesView";
import { useUser } from "@/components/auth/ClerkSafe";
import type { Conversation } from "@/lib/chat-store";
import type { MemorySources } from "@/lib/memory-sources.mjs";
import { conversationSources, type ConversationBrowserSource } from "@/lib/conversation-sources";

export function ConversationSourcesPanel({
  conversation,
  onOpenAttachment,
  onOpenMemory,
  onOpenBrowser,
  browserPreview,
}: {
  browserPreview?: ReactNode;
  conversation: Conversation;
  onOpenAttachment: (outputId: string) => void;
  onOpenMemory: (sources: MemorySources) => void;
  onOpenBrowser: (activity: ConversationBrowserSource) => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const inventory = useMemo(
    () => conversationSources(conversation, ownerId),
    [conversation, ownerId],
  );
  return (
    <>
      <ConversationSourcesView
        inventory={inventory}
        browserPreview={browserPreview}
        onOpenAttachment={onOpenAttachment}
        onOpenMemory={onOpenMemory}
        onOpenBrowser={onOpenBrowser}
      />
    </>
  );
}
