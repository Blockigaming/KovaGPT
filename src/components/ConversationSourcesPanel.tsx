import { useMemo, type ReactNode } from "react";
import { ConversationSourcesView } from "./ConversationSourcesView";
import { CloudBrowserPreviewImage } from "./CloudBrowserPreview";
import { useCloudBrowserPreview } from "@/hooks/use-cloud-browser-preview";
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
  compactBrowser = false,
  hideBrowser = false,
  hideAttachments = false,
}: {
  showActivity?: boolean;
  browserOnly?: boolean;
  compactBrowser?: boolean;
  hideBrowser?: boolean;
  hideAttachments?: boolean;
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
  const requestedPreview =
    (browserOnly || compactBrowser) && !browserPreview && !hideBrowser ? preview : null;
  const previewUrl = useCloudBrowserPreview(requestedPreview, ownerId);
  const browserRows = activeBrowserOnly && requestedPreview && !previewUrl ? [] : inventory.browser;
  return (
    <>
      <ConversationSourcesView
        inventory={
          browserOnly
            ? { providers: [], web: [], memory: [], attachments: [], browser: browserRows }
            : {
                ...inventory,
                browser: hideBrowser ? [] : inventory.browser,
                attachments: hideAttachments ? [] : inventory.attachments,
              }
        }
        activeBrowserOnly={activeBrowserOnly}
        compactBrowser={compactBrowser}
        separateInputs={separateInputs}
        hideSourcesHeading={hideSourcesHeading}
        browserPreview={
          browserPreview ??
          (previewUrl && requestedPreview ? (
            <CloudBrowserPreviewImage url={previewUrl} hostname={requestedPreview.hostname} />
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
