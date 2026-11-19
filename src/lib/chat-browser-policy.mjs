import { cloudBrowserOrigin } from "./cloud-browser-rules.mjs";

export function requestsChatBrowser(text) {
  return /^(?:please\s+)?(?:(?:use|open|start|launch)\s+(?:the\s+)?cloud browser\b|(?:open|visit|read|summarize|browse)\b[^\n]*\b(?:in|with|via)\s+(?:the\s+)?cloud browser\b)/i.test(
    text.trim(),
  );
}

export function chatBrowserDestination(text) {
  const links = text.match(/https?:\/\/[^\s<>"`]+/gi);
  if (links?.length !== 1) return null;
  try {
    const url = new URL(links[0].replace(/[),.!?;\]}]+$/, ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    cloudBrowserOrigin(url.origin);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
