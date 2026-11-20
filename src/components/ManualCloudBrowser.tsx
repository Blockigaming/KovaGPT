import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { CloudBrowserTakeover } from "./CloudBrowserTakeover";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import {
  normalizeBrowserActivity,
  type BrowserActivityMetadata,
} from "@/lib/browser-activity-contract.mjs";
import { cloudBrowserId, type CloudBrowserFrame } from "@/lib/cloud-browser-control";

export function ManualCloudBrowser({
  ownerId,
  url,
  onClose,
}: {
  ownerId: string;
  url: string;
  onClose: () => void;
}) {
  const [session, setSession] = useState<{
    browser: BrowserActivityMetadata;
    frame: CloudBrowserFrame;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const unavailable = "Cloud Browser is temporarily unavailable. Try again shortly.";
    void (async () => {
      try {
        const response = await fetchWithTimeoutAuthenticated(
          "/api/browser/open",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Kova-Owner": ownerId },
            body: JSON.stringify({ url }),
            signal: controller.signal,
          },
          25_000,
        );
        const body = await response.json();
        const browser = normalizeBrowserActivity(body.browser);
        if (controller.signal.aborted) return;
        if (
          !response.ok ||
          !browser?.previewPath ||
          !body.frame ||
          !cloudBrowserId.test(body.frame.id)
        )
          throw new Error(typeof body.error === "string" ? body.error : unavailable);
        setSession({ browser, frame: body.frame });
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : unavailable;
        setError(message);
        toast.error(message);
      }
    })();
    return () => controller.abort();
  }, [ownerId, url]);

  if (session)
    return (
      <CloudBrowserTakeover
        browser={session.browser}
        initialFrame={session.frame}
        ownerId={ownerId}
        description="You are controlling the Cloud Browser."
        onClose={onClose}
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
    );

  return (
    <BrowserWorkspace title="Cloud browser" onClose={onClose}>
      <p className="kova-cloud-browser-status" role="status">
        {error || "Opening Cloud Browser…"}
      </p>
    </BrowserWorkspace>
  );
}
