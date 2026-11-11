import { useEffect, useState } from "react";
import { ExternalLink, Globe2 } from "lucide-react";
import {
  fallbackLinkTitle,
  normalizeLinkPreviewUrl,
  siteNameForLink,
} from "@/lib/link-preview.mjs";
import "./link-preview.css";

type Preview = {
  title: string;
  siteName: string;
  iconUrl: string | null;
};

const cached = new Map<string, Preview>();
const pending = new Map<string, Promise<Preview | null>>();

function previewFor(url: string): Promise<Preview | null> {
  const prior = cached.get(url);
  if (prior) return Promise.resolve(prior);
  const inflight = pending.get(url);
  if (inflight) return inflight;

  const request = (async () => {
    try {
      const response = await fetch("/api/link-preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") return null;
      const item = data as Record<string, unknown>;
      if (
        item.url !== url ||
        typeof item.title !== "string" ||
        typeof item.siteName !== "string"
      ) {
        return null;
      }
      const icon =
        typeof item.iconUrl === "string" &&
        normalizeLinkPreviewUrl(item.iconUrl) === item.iconUrl &&
        (new URL(item.iconUrl).hostname === new URL(url).hostname ||
          (siteNameForLink(url) === "YouTube" &&
            new URL(item.iconUrl).hostname === "www.youtube.com"))
          ? item.iconUrl
          : null;
      const preview = {
        title: item.title.slice(0, 180),
        siteName: item.siteName.slice(0, 80),
        iconUrl: icon,
      };
      // Small in-memory reuse across composer and conversation renderers.
      if (cached.size >= 120) {
        const oldest = cached.keys().next().value;
        if (oldest) cached.delete(oldest);
      }
      cached.set(url, preview);
      return preview;
    } catch {
      return null;
    } finally {
      pending.delete(url);
    }
  })();
  pending.set(url, request);
  return request;
}

export function LinkPreviewChip({
  url,
  placement = "message",
}: {
  url: string;
  placement?: "composer" | "message";
}) {
  const normalized = normalizeLinkPreviewUrl(url);
  const [preview, setPreview] = useState<Preview | null>(() =>
    normalized ? (cached.get(normalized) ?? null) : null,
  );
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
    setPreview(normalized ? (cached.get(normalized) ?? null) : null);
    if (!normalized) return;
    let mounted = true;
    void previewFor(normalized).then((value) => {
      if (mounted) {
        setIconFailed(false);
        setPreview(value);
      }
    });
    return () => {
      mounted = false;
    };
  }, [normalized]);

  if (!normalized) return null;
  const title = preview?.title || fallbackLinkTitle(normalized);
  const site = preview?.siteName || siteNameForLink(normalized);
  // The favicon is only ever loaded from the linked site's own HTTPS origin.
  const iconUrl = preview?.iconUrl ?? new URL("/favicon.ico", normalized).toString();

  return (
    <div
      className={"kova-link-preview kova-link-preview-" + placement}
      data-testid="specific-link-preview"
      data-link-preview-url={normalized}
    >
      <a
        href={normalized}
        target="_blank"
        rel="noopener noreferrer"
        className="kova-link-preview-open"
        title={"Open " + title + " on " + site}
        aria-label={"Open " + title + " on " + site + " in a new tab"}
      >
        {!iconFailed ? (
          <img
            className="kova-link-preview-icon"
            src={iconUrl}
            alt=""
            width={24}
            height={24}
            loading="lazy"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Globe2 className="kova-link-preview-icon" aria-hidden="true" />
        )}
        <span className="kova-link-preview-labels">
          <span className="kova-link-preview-title">{title}</span>
          <span className="kova-link-preview-site">{site}</span>
        </span>
        <ExternalLink className="kova-link-preview-external" aria-hidden="true" />
      </a>
    </div>
  );
}
