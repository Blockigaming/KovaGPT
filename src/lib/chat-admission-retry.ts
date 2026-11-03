/** Retry only an explicit pre-generation concurrency rejection. Provider, quota,
 * network and streaming failures may have spent tokens and must not be replayed. */
export async function fetchChatWithAdmissionRetry(
  transport: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
  input: RequestInfo | URL,
  init: RequestInit,
  wait: (ms: number, signal?: AbortSignal | null) => Promise<void> = abortableWait,
): Promise<Response> {
  const delays = [500, 1500, 3000];
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await transport(input, init);
    if (response.status !== 429 || attempt >= delays.length) return response;
    let rejection: { code?: string; retryable?: boolean };
    try {
      rejection = await response.clone().json();
    } catch {
      return response;
    }
    if (
      !rejection.retryable ||
      !["principal_concurrency", "global_concurrency"].includes(rejection.code ?? "")
    )
      return response;
    await wait(delays[attempt], init.signal);
  }
}

function abortableWait(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
