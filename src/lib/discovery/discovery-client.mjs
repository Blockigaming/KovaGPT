import { readResponseBytesBounded } from "../endpoint-reliability.mjs";
export async function readDiscoveryResponse(response, signal) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw new Error("Invalid discovery response.");
  const bytes = await readResponseBytesBounded(response, 131072, { signal, timeoutMs: 10000 });
  try {
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new Error("Invalid discovery response.");
  }
}

/** Captures the owner before session acquisition and bounds every asynchronous stage. */
export async function requestDiscovery({
  owner,
  body,
  signal,
  getSession,
  fetchImpl = fetch,
  timeoutMs = 25000,
}) {
  const c = new AbortController();
  const abort = () => c.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => c.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  let sessionAbort;
  try {
    if (c.signal.aborted) throw c.signal.reason;
    const pending = new Promise((_, reject) => {
      sessionAbort = () => reject(c.signal.reason);
      c.signal.addEventListener("abort", sessionAbort, { once: true });
    });
    const result = await Promise.race([getSession(), pending]);
    c.signal.removeEventListener("abort", sessionAbort);
    const session = result?.data?.session;
    if (c.signal.aborted) throw c.signal.reason;
    if (session?.user?.id !== owner || !session.access_token)
      throw new Error("Your account changed. Please try again.");
    const response = await fetchImpl("/api/discovery", {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "X-Kova-Expected-User": owner,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: c.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    return { response, data: await readDiscoveryResponse(response, c.signal) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (sessionAbort) c.signal.removeEventListener("abort", sessionAbort);
  }
}
