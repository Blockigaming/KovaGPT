import { createBrowserEgress } from "../../work-runner/browser-egress.mjs";
import {
  cleanLinkTitle,
  fallbackLinkTitle,
  normalizeLinkPreviewUrl,
  readPageLinkMetadata,
  siteNameForLink,
} from "./link-preview.mjs";

// This egress pins a publicly routable IPv4 address after DNS validation, rejects
// internal destinations and credentials, and disables automatic redirects.
// No browser cookies, authorization, or account secrets are forwarded.
const publicRead = createBrowserEgress({
  origins: [],
  publicWeb: true,
  assertAuthority: async () => undefined,
});

async function readPublicPage(raw, signal, read = publicRead) {
  let current = normalizeLinkPreviewUrl(raw);
  if (!current) return null;
  for (let hop = 0; hop < 3; hop += 1) {
    const result = await read(
      {
        url: current,
        method: "GET",
        headers: {
          accept: "text/html,application/json;q=0.8",
          "user-agent": "KovaGPT-LinkPreview/1.0",
        },
        bodyBase64: "",
      },
      { signal },
    );
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers?.location;
      if (!location) return null;
      current = normalizeLinkPreviewUrl(new URL(location, current).toString());
      if (!current) return null;
      continue;
    }
    if (result.status !== 200) return null;
    const contentType = (result.headers?.["content-type"] ?? "").toLowerCase();
    if (!/^(?:text\/html|application\/json|text\/plain)(?:;|$)/u.test(contentType)) return null;
    return {
      contentType,
      url: current,
      text: Buffer.from(result.bodyBase64, "base64").toString("utf8").slice(0, 350_000),
    };
  }
  return null;
}

export async function resolveLinkPreview(raw, signal, read = publicRead) {
  const url = normalizeLinkPreviewUrl(raw);
  if (!url) return null;
  const siteName = siteNameForLink(url);
  const fallback = {
    url,
    title: fallbackLinkTitle(url),
    siteName,
    iconUrl: null,
  };

  if (siteName === "YouTube") {
    try {
      const oembed = new URL("https://www.youtube.com/oembed");
      oembed.searchParams.set("format", "json");
      oembed.searchParams.set("url", url);
      const page = await readPublicPage(oembed.toString(), signal, read);
      if (page?.contentType.startsWith("application/json")) {
        const record = JSON.parse(page.text);
        const title = cleanLinkTitle(record?.title);
        if (title) {
          return {
            ...fallback,
            title,
            iconUrl: "https://www.youtube.com/favicon.ico",
          };
        }
      }
    } catch {
      // Private, unavailable, and embed-disabled videos keep a safe fallback.
    }
  }

  try {
    const page = await readPublicPage(url, signal, read);
    if (!page?.contentType.startsWith("text/html")) return fallback;
    const metadata = readPageLinkMetadata(page.text, page.url);
    return {
      url,
      title: metadata.title || fallback.title,
      siteName: metadata.siteName || siteName,
      iconUrl: metadata.iconUrl || new URL("/favicon.ico", page.url).toString(),
    };
  } catch {
    return fallback;
  }
}
