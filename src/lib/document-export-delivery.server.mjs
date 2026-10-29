import { isCrossSiteMutation } from "./auth-security.mjs";
import { BoundedJsonError, readBoundedUtf8 } from "./bounded-json.server.mjs";
import { resolveAnonymousClientKey } from "./chat-ingress.server.mjs";
import {
  DOCUMENT_EXPORT_TYPES,
  MAX_DOCUMENT_EXPORT_BYTES,
  MAX_DOCUMENT_EXPORT_FORM_BYTES,
  safeExportDeliveryFilename,
} from "./document-export-policy.mjs";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
const MESSAGES = {
  400: "The download request was invalid. Return to your result and prepare the file again.",
  403: "This download must be requested from KovaGPT. Return to your result and try again.",
  405: "Use Download via server in your result to request a file.",
  413: "Server delivery supports files up to 8 MiB. Use a local download for larger files.",
  415: "The download request format was not supported. Return to your result and try again.",
  429: "Too many download requests. Wait a minute, then return to your result and try again.",
  503: "Download protection is temporarily unavailable. Return to your result and try again later.",
  504: "The download request timed out. Return to your result and prepare the file again.",
};
// Standalone ChatGPT-style neutral surface. Only these fixed CSS bytes are allowed.
const FAILURE_STYLE = `:root{color-scheme:light dark;--background:#ffffff;--foreground:#0d0d0d;--muted-foreground:#5d5d5d;--border:#00000014}*{box-sizing:border-box}body{font:16px/1.5 ui-sans-serif,-apple-system,system-ui,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;background:var(--background);color:var(--foreground);margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px}main{width:100%;max-width:448px;padding:32px;border:1px solid var(--border);border-radius:24px;overflow-wrap:anywhere}h1{margin:0;font-size:32px;font-weight:600;line-height:38px;letter-spacing:-0.02em}p{margin:12px 0 0;color:var(--muted-foreground);font-size:14px;line-height:20px}@media(prefers-color-scheme:dark){:root{--background:#212121;--foreground:#ffffff;--muted-foreground:#afafaf;--border:#ffffff1f}}@media(max-width:480px){main{padding:24px}h1{font-size:28px;line-height:34px}}`;
const FAILURE_STYLE_CSP =
  "default-src 'none'; sandbox; style-src 'sha256-Ymxsnjh0D7BXP4qSLySpND6HkjMdFJDNCeMO2Yasqy4='";

function failure(status, extra = {}) {
  // Only fixed text is rendered. Never reflect document bytes, names, or request fields.
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download unavailable</title><style>${FAILURE_STYLE}</style><main><h1>Download unavailable</h1><p>${MESSAGES[status]}</p><p>Your original result is still open in its tab. This request did not save a copy to your account.</p></main></html>`,
    {
      status,
      headers: {
        ...HEADERS,
        "Content-Security-Policy": FAILURE_STYLE_CSP,
        "Content-Type": "text/html;charset=utf-8",
        ...extra,
      },
    },
  );
}

/** Public, stateless byte relay. Cookies grant no authority and no account data is read.
 * The only payload is the caller's explicitly submitted file, held for this response.
 */
export async function handleDocumentExportDelivery(request, { consumeRateLimit }) {
  if (request.method !== "POST") return failure(405, { Allow: "POST" });
  const url = new URL(request.url);
  if (
    request.headers.get("origin") !== url.origin ||
    isCrossSiteMutation(request) ||
    url.search ||
    url.hash
  )
    return failure(403);
  const rate = await Promise.resolve()
    .then(() =>
      consumeRateLimit({
        identity: resolveAnonymousClientKey(request.headers),
        action: "document_export_delivery",
        limit: 10,
        windowSeconds: 60,
      }),
    )
    .catch(() => ({ allowed: false, status: "unavailable", retryAfter: 60 }));
  if (!rate.allowed)
    return failure(rate.status === "limited" ? 429 : 503, {
      "Retry-After": String(rate.retryAfter),
    });
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    return failure(415);

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 10_000);
  try {
    const raw = await readBoundedUtf8(request, MAX_DOCUMENT_EXPORT_FORM_BYTES, controller.signal);
    const fields = new URLSearchParams(raw);
    if (
      [...fields.keys()].length !== 3 ||
      !["format", "filename", "bytes"].every((key) => fields.has(key))
    )
      return failure(400);
    const format = fields.get("format");
    if (!Object.hasOwn(DOCUMENT_EXPORT_TYPES, format)) return failure(400);
    const filename = safeExportDeliveryFilename(fields.get("filename"), format);
    const encoded = fields.get("bytes");
    if (encoded.length > Math.ceil(MAX_DOCUMENT_EXPORT_BYTES / 3) * 4) return failure(413);
    if (!/^[A-Za-z0-9_-]*$/u.test(encoded) || encoded.length % 4 === 1) return failure(400);
    const decoded = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    if (decoded.length > MAX_DOCUMENT_EXPORT_BYTES) return failure(413);
    if (btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") !== encoded)
      return failure(400);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    // RFC 5987 extended filename; no caller-controlled MIME or disposition value.
    const encodedName = encodeURIComponent(filename).replace(
      /[!'()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(bytes, {
      headers: {
        ...HEADERS,
        "Content-Type": DOCUMENT_EXPORT_TYPES[format],
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return failure(504);
    return failure(error instanceof BoundedJsonError && error.status === 413 ? 413 : 400);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
