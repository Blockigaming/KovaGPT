import { useEffect, useState } from "react";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import type { BrowserActivityMetadata } from "@/lib/browser-activity-contract.mjs";

export function useCloudBrowserPreview(
  browser: BrowserActivityMetadata | null,
  ownerId: string | null,
) {
  const path = browser?.previewPath;
  const observedAt = browser?.observedAt ?? 0;
  const expiresAt = browser?.expiresAt ?? observedAt + 300000;
  const [preview, setPreview] = useState<{ path: string; ownerId: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    const now = Date.now();
    if (!path || !ownerId || observedAt > now + 30000 || now >= expiresAt) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const expire = () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreview(null);
    };
    const timeout = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    void fetchWithTimeoutAuthenticated(
      path,
      {
        headers: { "X-Kova-Owner": ownerId },
        cache: "no-store",
        signal: controller.signal,
      },
      5000,
    )
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return;
        const image = await response.blob();
        if (controller.signal.aborted || image.size > 350000) return;
        objectUrl = URL.createObjectURL(image);
        setPreview({ path, ownerId, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expiresAt, observedAt, ownerId, path]);
  return preview && preview.path === path && preview.ownerId === ownerId && Date.now() < expiresAt
    ? preview.url
    : null;
}
