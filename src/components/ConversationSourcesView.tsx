import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
import { ResponseSourceIcon } from "./ResponseSourceIcon";
import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
import type { ReactNode } from "react";
import {
  BookOpen,
  Plug,
  ChevronRight,
  File,
  Globe,
  Image,
  Monitor,
  GitBranch,
  Database,
  Zap,
  LibraryBig,
  Maximize2,
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
  const latest = inventory.browser.at(-1);
  if (!latest || latest.status !== "active" || !browserActivityIsFresh(latest.browser)) return null;
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
export function ConversationInputRows({
  attachments,
  onOpenAttachment,
}: {
  attachments: ConversationSourceInventory["attachments"];
  onOpenAttachment: (outputId: string) => void;
}) {
  return (
    <>
      {attachments.map((entry) => (
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
      {attachments.length > 0 && (
        <p className="kova-header-note">
          Attached to this chat. Use in a response is not confirmed.
        </p>
      )}
    </>
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
  activeBrowserOnly = false,
  compactBrowser = false,
  separateInputs = false,
  hideSourcesHeading = false,
}: {
  inventory: ConversationSourceInventory;
  onOpenAttachment: (outputId: string) => void;
  onOpenMemory: (sources: MemorySources) => void;
  onOpenBrowser?: (activity: ConversationBrowserSource) => void;
  browserPreview?: ReactNode;
  browserTabCount?: number;
  showActivity?: boolean;
  activeBrowserOnly?: boolean;
  compactBrowser?: boolean;
  separateInputs?: boolean;
  hideSourcesHeading?: boolean;
}) {
  const providers = inventory.providers ?? [];
  const latestBrowser = inventory.browser.at(-1);
  const browsers = activeBrowserOnly
    ? latestBrowser?.status === "active" && browserActivityIsFresh(latestBrowser.browser)
      ? [latestBrowser]
      : []
    : inventory.browser;
  const total =
    providers.length +
    inventory.web.length +
    inventory.memory.length +
    inventory.attachments.length +
    browsers.length;
  if (!total) return null;
  return (
    <section className="kova-conversation-sources" aria-label="Conversation sources">
      {!hideSourcesHeading &&
        providers.length +
          inventory.web.length +
          inventory.memory.length +
          (!separateInputs ? inventory.attachments.length : 0) >
          0 && <h2>Sources</h2>}
      {compactBrowser && browsers.length > 0 && (
        <div className="kova-browser-source-list" role="group" aria-label="Cloud browser">
          {browsers.map((activity) => {
            const latest = activity === latestBrowser;
            const active =
              latest && activity.status === "active" && browserActivityIsFresh(activity.browser);
            const tabs = active ? (browserTabCount ?? activity.browser?.tabCount) : undefined;
            const status = active
              ? "Active"
              : activity.status === "failed"
                ? "Failed"
                : activity.status === "canceled"
                  ? "Canceled"
                  : "Recorded";
            return (
              <button
                key={activity.id}
                type="button"
                className="kova-browser-source-row"
                aria-label={`Open browser activity${activity.browser?.hostname ? ` for ${activity.browser.hostname}` : ""}`}
                onClick={() => onOpenBrowser?.(activity)}
                disabled={!onOpenBrowser}
              >
                <span className="kova-browser-source-thumbnail">
                  {active && browserPreview ? browserPreview : <Monitor aria-hidden="true" />}
                </span>
                <span className="kova-browser-source-copy">
                  <span>Cloud browser</span>
                  <small>{activity.browser?.hostname ?? activity.label}</small>
                </span>
                <span className="kova-browser-source-status" data-active={active}>
                  {status}
                  {!!tabs && (
                    <small>
                      {tabs} {tabs === 1 ? "tab" : "tabs"}
                    </small>
                  )}
                </span>
                <Maximize2 className="kova-browser-source-expand" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {providers.map((entry) => {
        const Icon = {
          github: GitBranch,
          supabase: Database,
          firecrawl: Zap,
          library: LibraryBig,
          files: File,
          google: CloudSun,
          microsoft: CloudSun,
          plugin: Plug,
        }[entry.provider];
        const brand =
          entry.provider === "github"
            ? githubLogo
            : entry.pluginId
              ? PLUGIN_BRAND_ASSET_URLS[entry.pluginId]
              : null;
        return (
          <div
            key={entry.id}
            className={`kova-source-provider kova-source-provider-${entry.provider}`}
          >
            {brand ? (
              <img src={brand} width={16} height={16} alt="" />
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
                  <span className="flex min-w-0 items-center gap-2">
                    <ResponseSourceIcon
                      hostname={source.domain}
                      className="block h-4 w-4 shrink-0"
                    />
                    <span>{source.title}</span>
                  </span>
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
      {separateInputs && inventory.attachments.length > 0 ? <h2>Inputs</h2> : null}
      <ConversationInputRows
        attachments={inventory.attachments}
        onOpenAttachment={onOpenAttachment}
      />
      {!compactBrowser && browsers.length > 0 && (
        <section className="kova-browser-section" aria-label="Cloud browser">
          {showActivity ? (
            <ConversationActivitySummary inventory={inventory} browserTabCount={browserTabCount} />
          ) : null}
          <div className="kova-browser-section-heading">
            <h2>Cloud browser</h2>
            {browsers.length === 1 && (
              <span className="kova-source-state">
                {browsers[0].status === "active"
                  ? browserActivityIsFresh(browsers[0].browser)
                    ? "Active"
                    : "Recorded"
                  : browsers[0].status === "completed"
                    ? "Used"
                    : browsers[0].status === "failed"
                      ? "Failed"
                      : "Canceled"}
              </span>
            )}
          </div>
          {browsers.map((activity) => (
            <button
              key={activity.id}
              type="button"
              className="kova-browser-card"
              onClick={() => onOpenBrowser?.(activity)}
              disabled={!onOpenBrowser}
              aria-label="Open browser activity"
            >
              {browsers.length > 1 && <span className="sr-only">{activity.status}</span>}
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
