import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
import { chatBrowserDestination } from "@/lib/chat-browser-policy.mjs";
import { getLiveBrowserActivity, subscribeToLiveBrowserActivity } from "@/lib/message-activity-list.mjs";
import "./response-files.css";

const CloudBrowserTakeover = lazy(() =>
  import("./CloudBrowserTakeover").then((module) => ({ default: module.CloudBrowserTakeover })),
);

const ManualCloudBrowser = lazy(() =>
  import("./ManualCloudBrowser").then((module) => ({ default: module.ManualCloudBrowser })),
);

function BrowserDestinationCard({ ownerId }: { ownerId: string }) {
  const [input, setInput] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const destination = chatBrowserDestination(input.trim());
  return (
    <div className="my-3">
      <form
        className="kova-browser-destination-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (destination) setUrl(destination.href);
        }}
      >
        <label className="text-sm font-medium">
          <span>Cloud Browser</span>
          <input
            type="url"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="https://example.com"
            aria-label="Website address"
            required
          />
        </label>
        <button ref={trigger} type="submit" disabled={!destination}>
          Open browser
        </button>
      </form>
      {url && (
        <Suspense fallback={<p role="status">Opening browser…</p>}>
          <ManualCloudBrowser
            ownerId={ownerId}
            url={url}
            onClose={() => {
              setUrl(null);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export function ResponseBrowserCard({
  activities,
  ownerId,
  chatId,
  messageId,
}: {
  activities?: Activity[];
  ownerId: string;
  chatId?: string | null;
  messageId: string;
}) {
  const live = useSyncExternalStore(
    subscribeToLiveBrowserActivity,
    getLiveBrowserActivity,
    () => null,
  );
  const boundLive =
    live?.principal === ownerId &&
    live.conversationId === chatId &&
    live.messageId === messageId
      ? live.activity
      : undefined;
  const activity =
    boundLive ??
    activities
      ?.slice()
      .reverse()
      .find((row) => row.tool === "browser_interact" && row.browser);
  const browser = activity?.browser;
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!browser) return;
    setNow(Date.now());
    const expires = browser.expiresAt ?? browser.observedAt + 300_000;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [browser]);

  if (!browser || !browser.previewPath || !browserActivityIsFresh(browser, now)) {
    return activities?.some((row) => row.tool === "browser_open_request") ? (
      <BrowserDestinationCard ownerId={ownerId} />
    ) : null;
  }

  return (
    <div className="my-3">
      <button
        ref={trigger}
        type="button"
        className="kova-response-browser-card"
        onClick={() => setOpen(true)}
      >
        <Globe className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="kova-response-browser-details">
          <span className="block text-sm font-medium">Cloud Browser</span>
          <span className="block break-all text-xs text-muted-foreground">
            {browser.hostname ?? "Active browser session"}
          </span>
        </span>
        <span className="kova-response-browser-action">Open browser</span>
      </button>
      {open && (
        <Suspense fallback={<p role="status">Opening browser…</p>}>
          <CloudBrowserTakeover
            key={browser.sessionId}
            browser={browser}
            ownerId={ownerId}
            description={activity?.label ?? "Cloud Browser"}
            onClose={() => setOpen(false)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
