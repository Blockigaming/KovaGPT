// Shared, side-effect-free URL parsing for composer and message link chips.
// Never treat arbitrary user strings as image URLs, markup, or executable links.
const LINK_PATTERN = /https:\/\/[^\s<>"'\u0000-\u001f]+/giu;
const BLOCKED_SUFFIX = /\.(?:local|localhost|internal|invalid|test|example)$/iu;

export function normalizeLinkPreviewUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || !raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.hostname.includes(".") ||
      url.hostname.includes(":") ||
      /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) ||
      BLOCKED_SUFFIX.test(url.hostname) ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(url.hostname) ||
      url.hostname.split(".").some((part) => part.startsWith("-") || part.endsWith("-"))
    ) {
      return null;
    }
    // Fragments never identify a different HTTP document and must not be sent upstream.
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// One invisible text position represents the entire URL while its visual
// page chip is displayed. The canonical draft still stores the original link.
export const COMPOSER_LINK_MARKER = "\u2063";

export function firstLinkPreviewToken(text) {
  if (typeof text !== "string") return null;
  for (const match of text.slice(0, 20_000).matchAll(LINK_PATTERN)) {
    const raw = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    const url = normalizeLinkPreviewUrl(raw);
    if (url) return { raw, url, start: match.index, end: match.index + raw.length };
  }
  return null;
}

export function firstLinkPreviewUrl(text) {
  return firstLinkPreviewToken(text)?.url ?? null;
}

export function toComposerLinkDisplay(text, rawLink) {
  if (typeof text !== "string" || typeof rawLink !== "string" || !rawLink) return text;
  const start = text.indexOf(rawLink);
  if (start < 0) return text;
  return text.slice(0, start) + COMPOSER_LINK_MARKER + text.slice(start + rawLink.length);
}

export function fromComposerLinkDisplay(display, rawLink) {
  if (typeof display !== "string" || typeof rawLink !== "string" || !rawLink) return display;
  return display.replace(COMPOSER_LINK_MARKER, rawLink);
}

export function isOnlyLink(text, url) {
  return typeof text === "string" && normalizeLinkPreviewUrl(text.trim()) === url;
}

export function siteNameForLink(url) {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be")
    return "YouTube";
  if (hostname === "github.com" || hostname === "gist.github.com") return "GitHub";
  if (hostname === "reddit.com" || hostname.endsWith(".reddit.com")) return "Reddit";
  if (hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org"))
    return "Wikipedia";
  if (hostname === "docs.google.com") return "Google Docs";
  return hostname;
}

export function fallbackLinkTitle(url) {
  const parsed = new URL(url);
  const site = siteNameForLink(url);
  if (site === "YouTube") return "YouTube video";
  if (site === "GitHub") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 2).join("/");
  }
  return site;
}

function decodeHtmlEntities(input) {
  return input.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/giu, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    }
    return (
      {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
        ndash: "–",
        mdash: "—",
        hellip: "…",
        rsquo: "’",
        lsquo: "‘",
        ldquo: "“",
        rdquo: "”",
      }[entity.toLowerCase()] ?? match
    );
  });
}

export function cleanLinkTitle(input) {
  if (typeof input !== "string") return "";
  return decodeHtmlEntities(input.replace(/<[^>]*>/gu, ""))
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

export function readPageLinkMetadata(html, url) {
  const meta = {};
  let icon = null;
  for (const tag of html.slice(0, 350_000).match(/<(?:meta|link)\b[^>]*>/giu) ?? []) {
    const a = attributes(tag);
    if (/^<meta\b/iu.test(tag)) {
      const name = (a.property || a.name || "").toLowerCase();
      if (["og:title", "twitter:title", "og:site_name"].includes(name) && a.content) {
        meta[name] = cleanLinkTitle(a.content);
      }
    } else if (/\bicon\b/iu.test(a.rel ?? "") && a.href && !icon) {
      try {
        const candidate = new URL(a.href, url);
        if (
          candidate.protocol === "https:" &&
          candidate.hostname === new URL(url).hostname &&
          !candidate.username &&
          !candidate.password &&
          !candidate.port &&
          candidate.toString().length <= 2048
        ) {
          icon = candidate.toString();
        }
      } catch {
        // Malformed icons are optional.
      }
    }
  }
  const htmlTitle = html.slice(0, 350_000).match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return {
    title: meta["og:title"] || meta["twitter:title"] || cleanLinkTitle(htmlTitle) || "",
    siteName: meta["og:site_name"] || siteNameForLink(url),
    iconUrl: icon,
  };
}
