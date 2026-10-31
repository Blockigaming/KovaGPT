import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
import type { ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  File,
  Globe,
  Image,
  Monitor,
  GitBranch,
  Database,
  Zap,
  LibraryBig,
  CloudSun,
} from "lucide-react";
import githubLogo from "@/assets/plugins/github.svg";
import type {
  ConversationBrowserSource,
  ConversationSourceInventory,
} from "@/lib/conversation-sources";
import type { MemorySources } from "@/lib/memory-sources.mjs";
export function ConversationActivitySummary({
  inventory,
  browserTabCount,
}: {
  inventory: ConversationSourceInventory;
  browserTabCount?: number;
}) {
  const latest = [...inventory.browser]
    .reverse()
    .find((activity) => activity.status === "active" && browserActivityIsFresh(activity.browser));
  if (!latest) return null;
  const tabCount = browserTabCount ?? latest.browser?.tabCount;
  return (
    <div className="kova-source-activity">
      <h2>Activity</h2>
      <div>
        <Globe aria-hidden="true" />
        <span>Browser</span>
        {Number.isSafeInteger(tabCount) && tabCount! >= 0 ? (
          <small>
            {tabCount} {tabCount === 1 ? "tab" : "tabs"}
          </small>
        ) : (
          <small>Active</small>
        )}
      </div>
    </div>
  );
}
export function ConversationSourcesView({
  inventory,
  onOpenAttachment,
  onOpenMemory,
  onOpenBrowser,
  browserPreview,
  browserTabCount,
  showActivity = true,
}: {
  inventory: ConversationSourceInventory;
  onOpenAttachment: (outputId: string) => void;
  onOpenMemory: (sources: MemorySources) => void;
  onOpenBrowser?: (activity: ConversationBrowserSource) => void;
  browserPreview?: ReactNode;
  browserTabCount?: number;
  showActivity?: boolean;
}) {
  const providers = inventory.providers ?? [];
  const total =
    providers.length +
    inventory.web.length +
    inventory.memory.length +
    inventory.attachments.length +
    inventory.browser.length;
  if (!total) return null;
  return (
    <section className="kova-conversation-sources" aria-label="Conversation sources">
      {providers.length +
        inventory.web.length +
        inventory.memory.length +
        inventory.attachments.length >
        0 && <h2>Sources</h2>}
      {providers.map((entry) => {
        const Icon = {
          github: GitBranch,
          supabase: Database,
          firecrawl: Zap,
          library: LibraryBig,
          files: File,
          google: CloudSun,
          microsoft: CloudSun,
        }[entry.provider];
        return (
          <div
            key={entry.id}
            className={`kova-source-provider kova-source-provider-${entry.provider}`}
          >
            {entry.provider === "github" ? (
              <img src={githubLogo} width={16} height={16} alt="" />
            ) : (
              <Icon aria-hidden="true" />
            )}
            <span>{entry.name}</span>
            <small>
              {entry.status === "running"
                ? "Active"
                : entry.status === "failed"
                  ? "Failed"
                  : entry.status === "canceled"
                    ? "Canceled"
                    : `${entry.messageIds.length} ${entry.messageIds.length === 1 ? "turn" : "turns"}`}
            </small>
          </div>
        );
      })}
      {inventory.web.length > 0 && (
        <details className="kova-source-group">
          <summary>
            <Globe aria-hidden="true" />
            <span>Web search</span>
            <small>{inventory.web.length}</small>
            <ChevronRight aria-hidden="true" />
          </summary>
          <ol>
            {inventory.web.map(({ id, source }) => (
              <li key={id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <span>{source.title}</span>
                  <small>{source.domain}</small>
                  <span className="sr-only">Opens in a new tab</span>
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
      {inventory.memory.length > 0 && (
        <details className="kova-source-group">
          <summary>
            <BookOpen aria-hidden="true" />
            <span>Memory</span>
            <small>{inventory.memory.length}</small>
            <ChevronRight aria-hidden="true" />
          </summary>
          <p className="kova-header-note">
            Context provided to a response. This does not prove it influenced the answer.
          </p>
          {inventory.memory.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="kova-source-memory"
              onClick={() => onOpenMemory(entry.sources)}
            >
              {entry.name}
            </button>
          ))}
        </details>
      )}
      {inventory.attachments.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="kova-output-row"
          title={entry.name}
          onClick={() => onOpenAttachment(entry.outputId)}
        >
          {entry.attachmentKind === "image" ? (
            <Image aria-hidden="true" />
          ) : (
            <File aria-hidden="true" />
          )}
          <span className="kova-output-name">{entry.name}</span>
          <span className="kova-output-label">Available</span>
        </button>
      ))}
      {inventory.attachments.length > 0 && (
        <p className="kova-header-note">
          Attached to this chat. Use in a response is not confirmed.
        </p>
      )}
      {inventory.browser.length > 0 && (
        <section className="kova-browser-section" aria-label="Cloud browser">
          {showActivity ? (
            <ConversationActivitySummary inventory={inventory} browserTabCount={browserTabCount} />
          ) : null}
          <div className="kova-browser-section-heading">
            <h2>Cloud browser</h2>
            {inventory.browser.length === 1 && (
              <span className="kova-source-state">
                {inventory.browser[0].status === "active"
                  ? browserActivityIsFresh(inventory.browser[0].browser)
                    ? "Active"
                    : "Recorded"
                  : inventory.browser[0].status === "completed"
                    ? "Used"
                    : inventory.browser[0].status === "failed"
                      ? "Failed"
                      : "Canceled"}
              </span>
            )}
          </div>
          {inventory.browser.map((activity) => (
            <button
              key={activity.id}
              type="button"
              className="kova-browser-card"
              onClick={() => onOpenBrowser?.(activity)}
              disabled={!onOpenBrowser}
              aria-label="Open browser activity"
            >
              {inventory.browser.length > 1 && <span className="sr-only">{activity.status}</span>}
              {browserPreview ??
                (activity.status === "active" &&
                browserActivityIsFresh(activity.browser) &&
                activity.browser?.previewPath ? (
                  <span className="kova-browser-live-preview">
                    <img
                      src={activity.browser.previewPath}
                      alt="Current cloud browser preview"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    {activity.browser.hostname ? <small>{activity.browser.hostname}</small> : null}
                  </span>
                ) : (
                  <span className="kova-browser-card-content">
                    <Monitor aria-hidden="true" />
                    <strong>{activity.label}</strong>
                    <small>Recorded activity · no live preview</small>
                  </span>
                ))}
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
