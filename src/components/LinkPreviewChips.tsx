import { useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { extractLinkPreviewUrls, fallbackLinkTitle } from "@/lib/link-preview.mjs";
import "./link-preview.css";

type Preview = { url: string; title: string; site: string; faviconUrl: string };
const previewCache = new Map<string, Preview>();

/**
 * Presentation-only previews. The original URL remains in the draft / saved
 * prompt and is the text sent to the model. No link is silently rewritten.
 */
export function LinkPreviewChips({
  text,
  variant = "composer",
}: {
  text: string;
  variant?: "composer" | "sent";
}) {
  const urlsKey = extractLinkPreviewUrls(text).join("\n");
  const urls = useMemo(() => (urlsKey ? urlsKey.split("\n") : []), [urlsKey]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  useEffect(() => {
    if (!urls.length) return;
    const controller = new AbortController();
    let active = true;
    for (const url of urls) {
      const cached = previewCache.get(url);
      if (cached) {
        setPreviews((old) => (old[url] ? old : { ...old, [url]: cached }));
        continue;
      }
      void fetch("/api/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok || response.status === 204) return null;
          const data: unknown = await response.json();
          if (!data || typeof data !== "object") return null;
          const value = data as Partial<Preview>;
          if (value.url !== url || typeof value.title !== "string" ||
            !value.title || typeof value.faviconUrl !== "string" ||
            typeof value.site !== "string") return null;
          return value as Preview;
        })
        .then((preview) => {
          if (!preview || !active) return;
          previewCache.set(url, preview);
          if (previewCache.size > 200) previewCache.delete(previewCache.keys().next().value!);
          setPreviews((old) => ({ ...old, [url]: preview }));
        })
        .catch(() => {
          // A private page, unavailable site, or network failure keeps the URL intact.
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [urls]);

  if (!urls.length) return null;
  return (
    <ul className="kova-link-preview-list" data-variant={variant} aria-label="Linked pages">
      {urls.map((url) => {
        const preview = previews[url];
        const hostname = fallbackLinkTitle(url);
        const title = preview?.title || hostname;
        const favicon = preview?.faviconUrl || new URL("/favicon.ico", url).href;
        return (
          <li key={url} className="kova-link-preview-item">
            <a href={url} target="_blank" rel="noopener noreferrer" className="kova-link-preview-chip"
              aria-label={"Open " + title} title={title}>
              <span className="kova-link-preview-logo" aria-hidden="true">
                <Link2 className="kova-link-preview-fallback" />
                <img key={favicon} src={favicon} alt="" loading="lazy" referrerPolicy="no-referrer"
                  onError={(event) => { event.currentTarget.style.display = "none"; }} />
              </span>
              <span className="kova-link-preview-text">
                <span className="kova-link-preview-title">{title}</span>
                <span className="kova-link-preview-domain">{preview?.site || hostname}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
