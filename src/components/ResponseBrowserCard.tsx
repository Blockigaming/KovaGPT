import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
import "./response-files.css";

const CloudBrowserTakeover = lazy(() =>
  import("./CloudBrowserTakeover").then((module) => ({ default: module.CloudBrowserTakeover })),
);

export function ResponseBrowserCard({
  activities,
  ownerId,
}: {
  activities?: Activity[];
  ownerId: string;
}) {
  const activity = activities
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

  if (!browser || !browser.previewPath || !browserActivityIsFresh(browser, now)) return null;

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
