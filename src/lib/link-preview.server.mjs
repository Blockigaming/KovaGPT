import https from "node:https";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { cleanLinkTitle, fallbackLinkTitle, normalizeLinkPreviewUrl } from "./link-preview.mjs";

const MAX_BODY_BYTES = 128 * 1024;
const CACHE_DURATION_MS = 10 * 60 * 1000;
const cache = new Map();
const pending = new Map();
let activeRequests = 0;

export function isPublicPreviewIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || (b === 88 && c === 99) || (b === 168) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function safePreviewTarget(value) {
  const normalized = normalizeLinkPreviewUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (
    host.length > 253 || !host.includes(".") || host.endsWith(".") ||
    net.isIP(host) !== 0 ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.endsWith(".localhost") || host.endsWith(".test") ||
    host.endsWith(".onion") ||
    !host.split(".").every((label) =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label))
  ) return null;
  return url;
}

function decodeEntities(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (_match, hex, decimal) => {
    const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return Number.isSafeInteger(code) && code >= 32 && code <= 0x10ffff
      ? String.fromCodePoint(code) : " ";
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/giu, (_match, name) => named[name.toLowerCase()] || " ");
}

function attribute(tag, name) {
  const pattern = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = pattern.exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

export function extractHtmlLinkPreview(html, page) {
  const meta = [...html.matchAll(/<meta\b[^>]*>/giu)];
  let title = "";
  for (const [, tag] of meta.entries()) {
    const key = (attribute(tag[0], "property") || attribute(tag[0], "name")).toLowerCase();
    if (key === "og:title" || key === "twitter:title") {
      title = cleanLinkTitle(attribute(tag[0], "content"));
      if (title) break;
    }
  }
  if (!title) {
    const match = /<title\b[^>]*>([\s\S]{1,2000}?)<\/title>/iu.exec(html);
    if (match) title = cleanLinkTitle(decodeEntities(match[1]));
  }
  if (!title) return null;
  let faviconUrl = page.origin + "/favicon.ico";
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    if (!/(?:^|\s)(?:shortcut\s+)?icon(?:\s|$)/iu.test(attribute(match[0], "rel"))) continue;
    const href = attribute(match[0], "href");
    if (!href) continue;
    try {
      const icon = new URL(href, page);
      if (icon.protocol === "https:" && icon.origin === page.origin &&
        !icon.username && !icon.password) {
        faviconUrl = icon.href;
        break;
      }
    } catch {
      // Malformed icon URLs must not prevent showing the page title.
    }
  }
  return { title, faviconUrl };
}

async function publicAddress(host) {
  const records = await lookup(host, { family: 4, all: true });
  if (!records.length || records.some((record) => !isPublicPreviewIpv4(record.address))) return null;
  return records[0].address;
}

async function readPublicPage(target) {
  const pinnedAddress = await publicAddress(target.hostname);
  if (!pinnedAddress) return null;
  return new Promise((resolve) => {
    const request = https.request(target, {
      method: "GET",
      timeout: 4000,
      lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, 4),
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.8",
        "Accept-Encoding": "identity",
        "User-Agent": "KovaGPT-LinkPreview/1.0",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      const chunks = [];
      let count = 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location, contentType, body: "" });
        return;
      }
      response.on("data", (chunk) => {
        const remaining = MAX_BODY_BYTES - count;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        count += chunk.length;
        if (count >= MAX_BODY_BYTES) {
          // Most sites place their title and favicon in the first part of <head>.
          // Stop reading at the byte cap but retain this bounded prefix.
          resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") });
          request.destroy();
        }
      });
      response.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => resolve(null));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
    request.end();
  });
}

async function getPublicPage(initialUrl) {
  let current = initialUrl;
  for (let hop = 0; hop < 3; hop++) {
    const response = await readPublicPage(current);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400 && response.location && hop < 2) {
      const target = safePreviewTarget(new URL(response.location, current).href);
      if (!target) return null;
      current = target;
      continue;
    }
    return response.status === 200 ? { response, url: current } : null;
  }
  return null;
}

async function resolveUncached(url) {
  const host = url.hostname.replace(/^www\./iu, "");
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", url.href);
    endpoint.searchParams.set("format", "json");
    if (endpoint.href.length <= 2048) {
      const embed = await getPublicPage(endpoint);
      if (embed && embed.response.contentType.includes("application/json")) {
        try {
          const title = cleanLinkTitle(JSON.parse(embed.response.body).title);
          if (title) return { url: url.href, title, site: "YouTube", faviconUrl: "https://www.youtube.com/favicon.ico" };
        } catch {
          // Fall back to the public HTML metadata.
        }
      }
    }
  }
  const page = await getPublicPage(url);
  if (!page || !/text\/html|application\/xhtml\+xml/iu.test(page.response.contentType)) return null;
  const metadata = extractHtmlLinkPreview(page.response.body, page.url);
  if (!metadata) return null;
  return { url: url.href, title: metadata.title, site: fallbackLinkTitle(page.url.href), faviconUrl: metadata.faviconUrl };
}

export async function resolveLinkPreview(rawUrl) {
  const url = safePreviewTarget(rawUrl);
  if (!url) return null;
  const key = url.href;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < CACHE_DURATION_MS) return saved.value;
  if (pending.has(key)) return pending.get(key);
  if (activeRequests >= 6) return null;
  activeRequests += 1;
  const task = resolveUncached(url).catch(() => null).then((value) => {
    if (cache.size >= 250) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
    return value;
  }).finally(() => {
    pending.delete(key);
    activeRequests -= 1;
  });
  pending.set(key, task);
  return task;
}
