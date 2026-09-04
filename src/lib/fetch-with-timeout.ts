async function runWithFetchTimeout<T>(
  init: RequestInit,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await operation(controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  return runWithFetchTimeout(init, timeoutMs, (signal) => fetch(input, { ...init, signal }));
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<{ response: Response; body: T }> {
  return runWithFetchTimeout(init, timeoutMs, async (signal) => {
    const response = await fetch(input, { ...init, signal });
    const body = (await response.json()) as T;
    return { response, body };
  });
}
