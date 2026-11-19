import { useMemo, type ReactNode } from "react";
import { ConversationSourcesView } from "./ConversationSourcesView";
import { CloudBrowserPreview } from "./CloudBrowserPreview";
import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
export { ConversationActivitySummary } from "./ConversationSourcesView";
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
  browserTabCount,
  showActivity,
  activeBrowserOnly = false,
  separateInputs = false,
  hideSourcesHeading = false,
  browserOnly = false,
  hideBrowser = false,
}: {
  showActivity?: boolean;
  browserOnly?: boolean;
  hideBrowser?: boolean;
  activeBrowserOnly?: boolean;
  separateInputs?: boolean;
  hideSourcesHeading?: boolean;
  browserPreview?: ReactNode;
  browserTabCount?: number;
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
  const latest = inventory.browser.at(-1);
  const preview =
    latest?.status === "active" &&
    latest.browser?.previewPath &&
    browserActivityIsFresh(latest.browser)
      ? latest.browser
      : null;
  return (
    <>
      <ConversationSourcesView
        inventory={
          browserOnly
            ? { providers: [], web: [], memory: [], attachments: [], browser: inventory.browser }
            : hideBrowser
              ? { ...inventory, browser: [] }
              : inventory
        }
        activeBrowserOnly={activeBrowserOnly}
        separateInputs={separateInputs}
        hideSourcesHeading={hideSourcesHeading}
        browserPreview={
          browserPreview ??
          (browserOnly && ownerId && preview ? (
            <CloudBrowserPreview browser={preview} ownerId={ownerId} />
          ) : undefined)
        }
        browserTabCount={browserTabCount}
        showActivity={showActivity}
        onOpenAttachment={onOpenAttachment}
        onOpenMemory={onOpenMemory}
        onOpenBrowser={onOpenBrowser}
      />
    </>
  );
}
