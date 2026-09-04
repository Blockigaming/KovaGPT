export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
