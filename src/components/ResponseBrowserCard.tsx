import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";

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
    const expires = browser.expiresAt ?? browser.observedAt + 300_000;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [browser]);

  if (!browser || !browser.previewPath || !browserActivityIsFresh(browser, now))
    return null;

  return (
    <div className="my-3">
      <button
        ref={trigger}
        type="button"
        className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        <Globe className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Cloud Browser</span>
          <span className="block truncate text-xs text-muted-foreground">
            {browser.hostname ?? "Active browser session"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium">Open browser</span>
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
