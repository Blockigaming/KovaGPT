const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const MAX_URLS = 4;

export function normalizeLinkPreviewUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function extractLinkPreviewUrls(text, max = MAX_URLS) {
  if (typeof text !== "string" || !text) return [];
  const matches = text.match(URL_PATTERN) ?? [];
  const urls = new Set();
  for (const match of matches) {
    const candidate = match.replace(/[.,!?;:)\]}]+$/u, "");
    const url = normalizeLinkPreviewUrl(candidate);
    if (url) urls.add(url);
    if (urls.size >= Math.max(1, Math.min(max, 5))) break;
  }
  return [...urls];
}

export function fallbackLinkTitle(value) {
  try {
    return new URL(value).hostname.replace(/^www\./iu, "");
  } catch {
    return "Web link";
  }
}

export function cleanLinkTitle(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180);
}
