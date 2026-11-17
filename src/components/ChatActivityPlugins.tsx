import { ComposerPluginList, useComposerPluginConnections } from "./ComposerPluginList";
import { useUser } from "@/components/auth/ClerkSafe";
import type { Conversation } from "@/lib/chat-store";

export function ChatActivityPlugins({
  conversation,
  navigationBlocked,
  onSelect,
  onNavigate,
}: {
  conversation: Conversation;
  navigationBlocked: boolean;
  onSelect?: (plugin: { id: string; label: string }) => void;
  onNavigate: () => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const userId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const connections = useComposerPluginConnections(userId, isLoaded);
  return (
    <ComposerPluginList
      connections={connections}
      userId={userId}
      authLoaded={isLoaded}
      conversations={userId ? [conversation] : []}
      onSelect={onSelect}
      onNavigate={onNavigate}
      navigationBlocked={navigationBlocked}
      browseLabel="Browse all plugins"
      showAvailable
    />
  );
}
