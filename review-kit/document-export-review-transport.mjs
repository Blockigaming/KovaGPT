import { handleDocumentExportDelivery } from "../src/lib/document-export-delivery.server.mjs";
export { DOCUMENT_EXPORT_PATH } from "../src/lib/document-export-policy.mjs";

export const DOCUMENT_EXPORT_REVIEW_DISCLOSURE =
  "Download via server submits only the file bytes you explicitly prepared to this local review adapter. Use fictional review content only. The real delivery parser accepts at most 8 MiB and ten attempts per minute per disposable review session. Guest and Temporary review are eligible. No provider, account storage or live export service is contacted; browser delivery and saved bytes still require native verification.";

function inactive() {
  return new Response("Private review session is no longer active.", {
    status: 401,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain;charset=utf-8" },
  });
}

/** One disposable session limiter, not a replacement for production's distributed limiter.
 * State holds only a counter, timestamps and cancellation handles, never file bytes.
 */
export function createReviewDocumentExport({ isActive, now = Date.now }) {
  if (typeof isActive !== "function" || typeof now !== "function")
    throw new Error("Active private session and local clock required.");
  const pending = new Set();
  let disposed = false,
    count = 0,
    startedAt = null;
  return {
    get pendingCount() {
      return pending.size;
    },
    dispose() {
      disposed = true;
      count = 0;
      startedAt = null;
      for (const controller of pending) controller.abort();
    },
    async handle(request) {
      if (disposed || isActive() !== true) return inactive();
      const controller = new AbortController();
      const deliveryRequest = new Request(request, {
        signal: AbortSignal.any([request.signal, controller.signal]),
      });
      pending.add(controller);
      try {
        const result = await handleDocumentExportDelivery(deliveryRequest, {
          consumeRateLimit: async ({ action, limit, windowSeconds }) => {
            if (
              disposed ||
              isActive() !== true ||
              action !== "document_export_delivery" ||
              limit !== 10 ||
              windowSeconds !== 60
            )
              return { allowed: false, status: "unavailable", retryAfter: 60 };
            const time = now();
            if (!Number.isFinite(time))
              return { allowed: false, status: "unavailable", retryAfter: 60 };
            if (startedAt === null || time < startedAt || time - startedAt >= 60_000) {
              startedAt = time;
              count = 0;
            }
            if (count >= 10)
              return {
                allowed: false,
                status: "limited",
                retryAfter: Math.max(1, Math.ceil((60_000 - (time - startedAt)) / 1000)),
              };
            count += 1;
            return { allowed: true, status: "allowed", retryAfter: 0 };
          },
        });
        return disposed || isActive() !== true ? inactive() : result;
      } finally {
        pending.delete(controller);
        if (deliveryRequest.body && !deliveryRequest.body.locked)
          void deliveryRequest.body.cancel().catch(() => undefined);
      }
    },
  };
}

/** Stream the actual native body into the real bounded reader without collecting it
 * in general readBody. Cancellation pauses this request instead of destroying the
 * response socket, so an oversized form can still receive its fixed HTTP error.
 * The caller closes the connection after delivery; no unread body is retained.
 */
export function nativeDocumentExportRequest(request, url, signal) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  if (["GET", "HEAD"].includes(request.method))
    return new Request(url, { method: request.method, headers, signal });
  let cleanup;
  const body = new ReadableStream(
    {
      start(controller) {
        request.pause();
        const data = (chunk) => {
          request.pause();
          controller.enqueue(new Uint8Array(chunk));
        };
        const end = () => {
          cleanup();
          controller.close();
        };
        const error = (reason) => {
          cleanup();
          controller.error(reason);
        };
        const aborted = () => error(new DOMException("Request aborted", "AbortError"));
        cleanup = () => {
          request.off("data", data);
          request.off("end", end);
          request.off("error", error);
          request.off("aborted", aborted);
        };
        request.on("data", data);
        request.once("end", end);
        request.once("error", error);
        request.once("aborted", aborted);
      },
      pull() {
        request.resume();
      },
      cancel() {
        cleanup();
        request.pause();
      },
    },
    { highWaterMark: 0 },
  );
  return new Request(url, { method: request.method, headers, body, duplex: "half", signal });
}
