// Shared, side-effect-free URL parsing for composer and message link chips.
// Never treat arbitrary user strings as image URLs, markup, or executable links.
const LINK_PATTERN =
  /https:\/\/[^\s<>"'\u0000-\u001f]+|(?<![\p{L}\p{N}_.@:/\\%+-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?=$|[\s<>"'/\u0000-\u001f.,!?;:)\]}#])[^\s<>"'\u0000-\u001f]*/giu;
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

function* scanLinkPreviewTokens(text, requireBareDelimiter) {
  if (typeof text !== "string") return;
  for (const match of text.slice(0, 20_000).matchAll(LINK_PATTERN)) {
    const raw = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    const hasScheme = /^https:\/\//iu.test(raw);
    const end = match.index + raw.length;
    if (!hasScheme && requireBareDelimiter && end === text.length) continue;
    const url = normalizeLinkPreviewUrl(hasScheme ? raw : `https://${raw}`);
    if (url) yield { raw, url, start: match.index, end };
  }
}

export function firstLinkPreviewToken(text, { requireBareDelimiter = false } = {}) {
  return scanLinkPreviewTokens(text, requireBareDelimiter).next().value ?? null;
}

export function linkPreviewTokens(text, { requireBareDelimiter = false } = {}) {
  return Array.from(scanLinkPreviewTokens(text, requireBareDelimiter));
}

export function firstLinkPreviewUrl(text) {
  return firstLinkPreviewToken(text)?.url ?? null;
}

export function composerLinkDisplay(draft, collapsed) {
  let text = "";
  let previousEnd = 0;
  const positions = collapsed.map((token) => {
    text += draft.slice(previousEnd, token.start);
    const offset = text.length;
    text += COMPOSER_LINK_MARKER;
    previousEnd = token.end;
    return { offset, token };
  });
  return { text: text + draft.slice(previousEnd), positions };
}

export function canonicalComposerOffset(display, offset) {
  return display.positions.reduce(
    (position, link) => position + (link.offset < offset ? link.token.raw.length - 1 : 0),
    offset,
  );
}

export function composerTextChange(previous, next, caret) {
  // Match the unchanged suffix after the caret first. Several invisible URL
  // markers can look identical, so prefix matching alone can remove the wrong link.
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > 0 && nextEnd > caret && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd--;
    nextEnd--;
  }
  let start = 0;
  while (start < previousEnd && start < nextEnd && previous[start] === next[start]) start++;
  return { start, end: previousEnd, text: next.slice(start, nextEnd) };
}

export function isOnlyLink(text, url) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  const token = firstLinkPreviewToken(trimmed);
  return token?.start === 0 && token.end === trimmed.length && token.url === url;
}

export function siteNameForLink(url) {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be")
    return "YouTube";
  if (hostname === "github.com" || hostname === "gist.github.com") return "GitHub";
  if (hostname === "reddit.com" || hostname.endsWith(".reddit.com")) return "Reddit";
  if (hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org")) return "Wikipedia";
  if (hostname === "docs.google.com") return "Google Docs";
  return hostname;
}

export function fallbackLinkTitle(url) {
  const parsed = new URL(url);
  const site = siteNameForLink(url);
  if (site === "YouTube" && parsed.pathname !== "/") return "YouTube video";
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
