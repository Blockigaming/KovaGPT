import type { ReactNode } from "react";
import { BookOpen, ChevronRight, File, Globe, Image, Monitor } from "lucide-react";
import type {
  ConversationBrowserSource,
  ConversationSourceInventory,
} from "@/lib/conversation-sources";
import type { MemorySources } from "@/lib/memory-sources.mjs";
export function ConversationSourcesView({
  inventory,
  onOpenAttachment,
  onOpenMemory,
  onOpenBrowser,
  browserPreview,
}: {
  inventory: ConversationSourceInventory;
  onOpenAttachment: (outputId: string) => void;
  onOpenMemory: (sources: MemorySources) => void;
  onOpenBrowser?: (activity: ConversationBrowserSource) => void;
  browserPreview?: ReactNode;
}) {
  const total =
    inventory.web.length +
    inventory.memory.length +
    inventory.attachments.length +
    inventory.browser.length;
  if (!total) return null;
  return (
    <section className="kova-conversation-sources" aria-label="Conversation sources">
      {inventory.web.length + inventory.memory.length + inventory.attachments.length > 0 && (
        <h2>Sources</h2>
      )}
      {inventory.web.length > 0 && (
        <details className="kova-source-group">
          <summary>
            <Globe aria-hidden="true" />
            <span>Web sources</span>
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
            <span>Memory provided</span>
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
          <div className="kova-browser-section-heading">
            <h2>Cloud browser</h2>
            {inventory.browser.length === 1 && (
              <span className="kova-source-state">
                {browserPreview
                  ? "Sample"
                  : inventory.browser[0].status === "active"
                    ? "Active"
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
              {browserPreview ?? (
                <span className="kova-browser-card-content">
                  <Monitor aria-hidden="true" />
                  <strong>{activity.label}</strong>
                  <small>Recorded activity · no live preview</small>
                </span>
              )}
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
