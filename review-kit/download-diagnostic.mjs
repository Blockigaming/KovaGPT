import { createHash } from "node:crypto";

// Explicit private review page only. No application imports or data inputs.
export const DOWNLOAD_DIAGNOSTIC_PATH = "/__private-review/download-diagnostic";
export function downloadDiagnosticPaths(sessionId) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(sessionId ?? "")
  )
    throw new Error("Synthetic diagnostic session ID required.");
  const page = DOWNLOAD_DIAGNOSTIC_PATH + "/" + sessionId;
  return { page, attachment: page + "/sample.txt" };
}
export const DOWNLOAD_DIAGNOSTIC_TEXT =
  "Kova private download diagnostic\n" +
  "Fictional local sample only.\n" +
  "UTF-8 sample: café · Δ · ✓\n" +
  "No account data, provider output or saved-file claim.\n";
export const DOWNLOAD_DIAGNOSTIC_FILES = Object.freeze({
  button: "synthetic-mounted-blob.txt",
  link: "synthetic-direct-blob.txt",
  http: "synthetic-http-attachment.txt",
});
export const DOWNLOAD_DIAGNOSTIC_BYTES = Buffer.byteLength(DOWNLOAD_DIAGNOSTIC_TEXT, "utf8");
export const DOWNLOAD_DIAGNOSTIC_SHA256 = createHash("sha256")
  .update(DOWNLOAD_DIAGNOSTIC_TEXT, "utf8")
  .digest("hex");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function downloadDiagnosticScript() {
  // Both fixed Blob URLs remain valid for this page's lifetime. No short revoke
  // timer can race a download, and at most two tiny fixed Blobs are allocated.
  // The mounted-anchor click is synchronous inside the explicit button handler.
  return `(()=>{
const text=${JSON.stringify(DOWNLOAD_DIAGNOSTIC_TEXT)},type='text/plain;charset=utf-8';
const button=document.getElementById('blob-button'),mounted=document.getElementById('mounted-blob-anchor'),direct=document.getElementById('direct-blob-link'),http=document.getElementById('http-attachment-link');
const buttonStatus=document.getElementById('button-status'),linkStatus=document.getElementById('link-status'),httpStatus=document.getElementById('http-status'),errors=document.getElementById('browser-errors');
let buttonUrl=null,linkUrl=null;
const describe=error=>String(error?.message||error||'Unknown browser error').slice(0,300);
const record=value=>{const row=document.createElement('li');row.textContent=value;errors.append(row);while(errors.children.length>10)errors.firstElementChild.remove();};
window.addEventListener('error',event=>record('Browser error event: '+describe(event.message||'A resource error was observed.')),true);
window.addEventListener('unhandledrejection',event=>record('Unhandled rejection event: '+describe(event.reason)));
window.addEventListener('securitypolicyviolation',event=>record('CSP event: '+String(event.effectiveDirective||'unknown directive').slice(0,80)+'; '+String(event.disposition||'unknown disposition').slice(0,40)));
const prepareDirect=()=>{try{if(!linkUrl)linkUrl=URL.createObjectURL(new Blob([text],{type}));direct.href=linkUrl;direct.removeAttribute('aria-disabled');linkStatus.textContent='Blob link ready. Click it directly; saved output cannot be confirmed here.';}catch(error){direct.removeAttribute('href');direct.setAttribute('aria-disabled','true');linkStatus.textContent='Blob preparation raised an error: '+describe(error);record(linkStatus.textContent);}};
button.addEventListener('click',()=>{try{if(!buttonUrl)buttonUrl=URL.createObjectURL(new Blob([text],{type}));mounted.href=buttonUrl;mounted.click();buttonStatus.textContent='Button handler invoked the mounted Blob anchor. No JavaScript exception was observed; saved output is unknown.';}catch(error){buttonStatus.textContent='Button attempt raised an error: '+describe(error);record(buttonStatus.textContent);}});
direct.addEventListener('click',event=>{if(!linkUrl){event.preventDefault();linkStatus.textContent='No Blob URL is ready. Reload this diagnostic page to prepare it again.';return;}linkStatus.textContent='Direct Blob link activated. The browser handles the download; saved output is unknown.';});
http.addEventListener('click',()=>{httpStatus.textContent='HTTP attachment link activated. This page cannot confirm request arrival or a saved file.';});
window.addEventListener('pagehide',()=>{for(const url of [buttonUrl,linkUrl])if(url)URL.revokeObjectURL(url);buttonUrl=null;linkUrl=null;mounted.removeAttribute('href');direct.removeAttribute('href');direct.setAttribute('aria-disabled','true');});
window.addEventListener('pageshow',event=>{if(event.persisted)prepareDirect();});
prepareDirect();
})();`;
}

export function renderDownloadDiagnostic(sessionId) {
  const paths = downloadDiagnosticPaths(sessionId);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private synthetic download diagnostic</title><style>body{margin:0;background:#191919;color:#eee;font:16px/1.5 system-ui}main{max-width:800px;margin:auto;padding:24px}h1{font-size:24px}section{border:1px solid #666;border-radius:8px;padding:16px;margin:20px 0}button,a.action{display:inline-flex;align-items:center;box-sizing:border-box;min-height:44px;padding:8px 14px;border:1px solid #888;border-radius:8px;background:#292929;color:#eee;font:inherit}a{color:#a8d1ff}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}p{margin:12px 0}.notice{border-left:4px solid #a8d1ff;padding-left:16px}[aria-disabled=true]{opacity:.65}</style></head><body><main>
<h1>Private synthetic download diagnostic</h1>
<p class="notice">This separate review page contains only the fixed fictional text shown below. Choose a control explicitly. Local statuses and browser error events report attempts only; this page cannot confirm that a file was saved. No application behavior, permissions or browser policies are changed.</p>
<p><a href="/__local-review">Return to review controls without resetting</a>. Open this page from the active review controller. Reset or sign-out blocks its later HTTP requests. Already prepared Blob links contain only the fixed fictional text and remain local until this page closes or is left.</p>
<section aria-labelledby="button-heading"><h2 id="button-heading">1. Blob button with mounted anchor</h2><p>Filename: <code>${DOWNLOAD_DIAGNOSTIC_FILES.button}</code>. The button synchronously clicks a hidden anchor already mounted in this page.</p><button id="blob-button" type="button">Attempt mounted Blob download</button><a id="mounted-blob-anchor" download="${DOWNLOAD_DIAGNOSTIC_FILES.button}" hidden aria-hidden="true" tabindex="-1"></a><p id="button-status" role="status">No button attempt yet.</p></section>
<section aria-labelledby="link-heading"><h2 id="link-heading">2. Direct visible Blob link</h2><p>Filename: <code>${DOWNLOAD_DIAGNOSTIC_FILES.link}</code>. Click the visible link itself. Its handler records the action and leaves native link activation unchanged.</p><a id="direct-blob-link" class="action" download="${DOWNLOAD_DIAGNOSTIC_FILES.link}" aria-disabled="true" tabindex="0">Download fixed Blob through this link</a><p id="link-status" role="status">Preparing the fixed local Blob link.</p></section>
<section aria-labelledby="http-heading"><h2 id="http-heading">3. Same-origin HTTP attachment</h2><p>Filename: <code>${DOWNLOAD_DIAGNOSTIC_FILES.http}</code>. This ordinary link requests fixed UTF-8 bytes with an attachment response header.</p><a id="http-attachment-link" class="action" href="${paths.attachment}">Request fixed HTTP attachment</a><p id="http-status" role="status">No HTTP attachment action yet.</p></section>
<h2>Exact fictional payload</h2><p>All three methods use the same ${DOWNLOAD_DIAGNOSTIC_BYTES} UTF-8 bytes. SHA-256: <code>${DOWNLOAD_DIAGNOSTIC_SHA256}</code>.</p><pre>${escapeHtml(DOWNLOAD_DIAGNOSTIC_TEXT)}</pre>
<h2>Observed browser error events</h2><p>Only events delivered to this page are shown, up to ten. An empty list does not prove a download succeeded. Browser-level denials may produce no JavaScript event.</p><ol id="browser-errors" aria-live="polite"></ol>
<script>${downloadDiagnosticScript()}</script></main></body></html>`;
}

export function downloadDiagnosticResponse({
  url,
  rawPath,
  method,
  active,
  sessionId,
  hasBody = false,
}) {
  if (
    url.pathname !== DOWNLOAD_DIAGNOSTIC_PATH &&
    !url.pathname.startsWith(DOWNLOAD_DIAGNOSTIC_PATH + "/")
  )
    return null;
  if (!active)
    return {
      status: 401,
      json: { error: "Open an active synthetic review session before using this diagnostic." },
    };
  const paths = downloadDiagnosticPaths(sessionId);
  if (![paths.page, paths.attachment].includes(url.pathname))
    return {
      status: 404,
      json: { error: "Unknown synthetic download diagnostic resource or session." },
    };
  if (rawPath !== url.pathname)
    return {
      status: 400,
      json: { error: "Exact diagnostic paths only; no query or payload inputs." },
    };
  if (!["GET", "HEAD"].includes(method))
    return {
      status: 405,
      headers: { Allow: "GET, HEAD" },
      json: { error: "Synthetic download diagnostics are read-only." },
    };
  if (hasBody)
    return {
      status: 400,
      json: { error: "Synthetic download diagnostics accept no request body." },
    };
  if (url.pathname === paths.page)
    return { contentType: "text/html; charset=utf-8", body: renderDownloadDiagnostic(sessionId) };
  return {
    contentType: "text/plain; charset=utf-8",
    headers: {
      "Content-Disposition": `attachment; filename="${DOWNLOAD_DIAGNOSTIC_FILES.http}"`,
      "Content-Length": String(DOWNLOAD_DIAGNOSTIC_BYTES),
    },
    body: Buffer.from(DOWNLOAD_DIAGNOSTIC_TEXT, "utf8"),
  };
}
