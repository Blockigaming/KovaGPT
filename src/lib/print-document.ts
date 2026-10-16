export function printDocumentPaper(element: HTMLDivElement) {
  const frame = document.createElement("iframe");
  frame.title = "Print current document draft";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;width:800px;height:1px;left:-10000px;top:0;border:0";
  let active = true;
  const cleanup = () => {
    active = false;
    frame.onload = null;
    window.clearTimeout(loadTimer);
    if (frame.contentWindow) frame.contentWindow.onafterprint = null;
    frame.remove();
  };
  const loadTimer = window.setTimeout(cleanup, 15000);
  frame.onload = () => {
    if (!active || !frame.isConnected) return;
    window.clearTimeout(loadTimer);
    const target = frame.contentWindow;
    if (!target) {
      cleanup();
      return;
    }
    target.onafterprint = cleanup;
    target.focus();
    target.print();
  };
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Current document draft</title><style>@page{margin:18mm}body{color:#000;background:#fff;font:12pt/1.55 Georgia,serif}h1,h2,h3{break-after:avoid}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}a{color:#000}blockquote{border-left:2px solid #777;padding-left:12px}img{max-width:100%}</style></head><body>${element.innerHTML}</body></html>`;
  document.body.appendChild(frame);
  return cleanup;
}
