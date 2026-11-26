import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, Globe } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import {
  browserActivityIsFresh,
  normalizeBrowserActivity,
} from "@/lib/browser-activity-contract.mjs";
import { chatBrowserDestination } from "@/lib/chat-browser-policy.mjs";
import {
  getLiveBrowserActivity,
  subscribeToLiveBrowserActivity,
} from "@/lib/message-activity-list.mjs";
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
    () => {
      const live = getLiveBrowserActivity();
      return live?.principal === ownerId &&
        live.conversationId === chatId &&
        live.messageId === messageId
        ? live.activity
        : null;
    },
    () => null,
  );
  const activity =
    live ??
    activities
      ?.slice()
      .reverse()
      .find((row) => row.tool === "browser_interact" && row.browser);
  const browser = useMemo(() => normalizeBrowserActivity(activity?.browser), [activity?.browser]);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!browser) return;
    setNow(Date.now());
    const expires = browser.expiresAt ?? browser.observedAt + 300_000;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [browser]);

  if (
    !browser ||
    !/^[0-9a-f-]{36}$/iu.test(browser.sessionId) ||
    browser.previewPath !== `/api/browser/preview/${browser.sessionId}` ||
    !browserActivityIsFresh(browser, now)
  ) {
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
        title={browser.hostname ?? "Active browser session"}
        onClick={() => setOpenSession(browser.sessionId)}
      >
        <Globe className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="kova-response-browser-action">Open cloud browser</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      {openSession === browser.sessionId && (
        <Suspense fallback={<p role="status">Opening browser…</p>}>
          <CloudBrowserTakeover
            key={browser.sessionId}
            browser={browser}
            ownerId={ownerId}
            description={activity?.label ?? "Cloud Browser"}
            onClose={() => setOpenSession(null)}
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
