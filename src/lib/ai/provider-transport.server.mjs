const DEFAULT_IDENTITY_RESPONSE_LIMIT_BYTES = 64 * 1024;

export class ProviderTransportTimeoutError extends Error {
  constructor(phase = "provider_request") {
    super("provider_timeout");
    this.name = "AbortError";
    this.code = "provider_timeout";
    this.phase = phase;
  }
}

export function isProviderTimeoutError(error) {
  return Boolean(error && typeof error === "object" && error.code === "provider_timeout");
}

export function isAbortError(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error.name === "AbortError" || isProviderTimeoutError(error)),
  );
}

function timeoutMsOrThrow(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }
  return Math.floor(timeoutMs);
}

function abortReason(signal, phase) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (signal?.reason && typeof signal.reason === "object") return signal.reason;
  const error = new Error(`${phase}_aborted`);
  error.name = "AbortError";
  return error;
}

export function createRequestDeadline(parentSignal, timeoutMs, phase = "provider_request") {
  const boundedTimeoutMs = timeoutMsOrThrow(timeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  let parentAborted = false;
  let cleaned = false;
  let timeoutError;
  let timer;

  const onParentAbort = () => {
    parentAborted = true;
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) {
      controller.abort(abortReason(parentSignal, phase));
    }
  };

  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  if (!parentAborted) {
    timer = setTimeout(() => {
      if (cleaned || parentAborted || controller.signal.aborted) return;
      timedOut = true;
      timeoutError = new ProviderTransportTimeoutError(phase);
      controller.abort(timeoutError);
    }, boundedTimeoutMs);
  }

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  };

  return {
    signal: controller.signal,
    timeoutMs: boundedTimeoutMs,
    phase,
    didTimeout: () => timedOut,
    didParentAbort: () => parentAborted,
    normalize(error) {
      if (timedOut) return timeoutError ?? new ProviderTransportTimeoutError(phase);
      if (controller.signal.aborted) return abortReason(controller.signal, phase);
      return error;
    },
    cleanup,
  };
}

export async function waitForPromiseWithSignal(promise, signal, phase = "provider_request") {
  if (!signal) return promise;
  if (signal.aborted) throw abortReason(signal, phase);

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortReason(signal, phase));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function finishOnce(callback) {
  let finished = false;
  return (event) => {
    if (finished) return;
    finished = true;
    callback?.(event);
  };
}

function cancelReaderWithoutWaiting(reader, reason) {
  try {
    void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must never extend the request lifetime.
  }
}

function cancelBodyWithoutWaiting(body, reason) {
  if (!body) return;
  try {
    void Promise.resolve(body.cancel(reason)).catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must never extend the request lifetime.
  }
}

function deadlineOutcome(deadline, error) {
  if (deadline.didTimeout() || isProviderTimeoutError(error)) return "timeout";
  if (deadline.didParentAbort() || (deadline.signal.aborted && isAbortError(error))) {
    return "aborted";
  }
  return "failed";
}

export function wrapResponseBodyWithDeadline(response, deadline, onFinish) {
  const finish = finishOnce(onFinish);
  if (!response.body) {
    deadline.cleanup();
    finish({ outcome: "completed", status: response.status });
    return response;
  }

  const reader = response.body.getReader();
  let settled = false;
  let activeController;

  const cleanup = () => {
    deadline.signal.removeEventListener("abort", onAbort);
    deadline.cleanup();
  };

  const settle = (outcome, error) => {
    if (settled) return false;
    settled = true;
    cleanup();
    finish({ outcome, status: response.status, error });
    return true;
  };

  const onAbort = () => {
    const error = deadline.normalize(abortReason(deadline.signal, deadline.phase));
    if (!settle(deadlineOutcome(deadline, error), error)) return;
    cancelReaderWithoutWaiting(reader, error);
    try {
      activeController?.error(error);
    } catch {
      // The consumer may have closed or errored the stream in the same turn.
    }
  };

  const body = new ReadableStream({
    start(controller) {
      activeController = controller;
      deadline.signal.addEventListener("abort", onAbort, { once: true });
      if (deadline.signal.aborted) onAbort();
    },
    async pull(controller) {
      if (settled) return;
      try {
        const { done, value } = await reader.read();
        if (settled) return;
        if (done) {
          settle("completed");
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const normalized = deadline.normalize(error);
        if (!settle(deadlineOutcome(deadline, normalized), normalized)) return;
        cancelReaderWithoutWaiting(reader, normalized);
        controller.error(normalized);
      }
    },
    cancel(reason) {
      if (!settle("cancelled", reason)) return;
      cancelReaderWithoutWaiting(reader, reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function fetchWithDeadline(fetchImpl, input, init, deadline, onFinish) {
  const fetchPromise = Promise.resolve().then(() =>
    fetchImpl(input, {
      ...init,
      signal: deadline.signal,
    }),
  );

  void fetchPromise.then(
    (lateResponse) => {
      if (!deadline.signal.aborted) return;
      cancelBodyWithoutWaiting(
        lateResponse.body,
        deadline.normalize(abortReason(deadline.signal, deadline.phase)),
      );
    },
    () => undefined,
  );

  try {
    const response = await waitForPromiseWithSignal(fetchPromise, deadline.signal, deadline.phase);
    if (deadline.signal.aborted) {
      const error = deadline.normalize(abortReason(deadline.signal, deadline.phase));
      cancelBodyWithoutWaiting(response.body, error);
      throw error;
    }
    return wrapResponseBodyWithDeadline(response, deadline, onFinish);
  } catch (error) {
    const normalized = deadline.normalize(error);
    deadline.cleanup();
    onFinish?.({
      outcome: deadlineOutcome(deadline, normalized),
      error: normalized,
    });
    throw normalized;
  }
}

function parseExpiry(value, now) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return now() + 5 * 60_000;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now() + 5 * 60_000;
}

async function readBoundedJsonObject(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      await response.body?.cancel("managed_identity_response_rejected").catch(() => undefined);
      throw new Error("azure_managed_identity_unavailable");
    }
  }

  if (!response.body) throw new Error("azure_managed_identity_unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > maxBytes - total) {
        throw new Error("azure_managed_identity_unavailable");
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel("managed_identity_response_rejected").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("azure_managed_identity_unavailable");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("azure_managed_identity_unavailable");
  }
  return value;
}

export function createManagedIdentityTokenFetcher({
  env,
  resource,
  fetchImpl = globalThis.fetch,
  getTimeoutMs,
  now = Date.now,
  log,
  maxResponseBytes = DEFAULT_IDENTITY_RESPONSE_LIMIT_BYTES,
}) {
  let cachedToken;
  let sharedRequest;

  const acquire = async () => {
    const endpointValue = env("IDENTITY_ENDPOINT");
    const identityHeader = env("IDENTITY_HEADER");
    if (!endpointValue || !identityHeader) throw new Error("azure_managed_identity_unavailable");

    let endpoint;
    try {
      endpoint = new URL(endpointValue);
    } catch {
      throw new Error("azure_managed_identity_unavailable");
    }
    if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password || endpoint.hash) {
      throw new Error("azure_managed_identity_unavailable");
    }

    endpoint.searchParams.set("resource", resource);
    endpoint.searchParams.set("api-version", "2019-08-01");
    const clientId = env("AZURE_CLIENT_ID");
    if (clientId) endpoint.searchParams.set("client_id", clientId);

    const timeoutMs = timeoutMsOrThrow(getTimeoutMs());
    const startedAt = now();
    log?.("info", "managed_identity.token.start", {
      timeoutMs,
      clientIdConfigured: Boolean(clientId),
    });

    const deadline = createRequestDeadline(undefined, timeoutMs, "managed_identity_auth");
    try {
      const response = await fetchWithDeadline(
        fetchImpl,
        endpoint,
        {
          method: "GET",
          redirect: "error",
          headers: { "X-IDENTITY-HEADER": identityHeader },
        },
        deadline,
      );
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel("managed_identity_rejected").catch(() => undefined);
        log?.("warn", "managed_identity.token.rejected", {
          status,
          durationMs: now() - startedAt,
        });
        throw new Error("azure_managed_identity_unavailable");
      }

      const value = await readBoundedJsonObject(response, maxResponseBytes);
      const accessToken = typeof value.access_token === "string" ? value.access_token : "";
      if (!accessToken) throw new Error("azure_managed_identity_unavailable");

      cachedToken = {
        accessToken,
        expiresAtMs: parseExpiry(value.expires_on, now),
      };
      log?.("info", "managed_identity.token.complete", {
        durationMs: now() - startedAt,
      });
      return accessToken;
    } catch (error) {
      deadline.cleanup();
      const normalized = deadline.normalize(error);
      if (isProviderTimeoutError(normalized)) {
        log?.("warn", "managed_identity.token.timeout", {
          timeoutMs,
          durationMs: now() - startedAt,
          code: "provider_timeout",
        });
        throw normalized;
      }
      log?.("warn", "managed_identity.token.failed", {
        durationMs: now() - startedAt,
        code: "azure_managed_identity_unavailable",
      });
      throw new Error("azure_managed_identity_unavailable");
    }
  };

  return async function fetchManagedIdentityToken(signal) {
    if (cachedToken && cachedToken.expiresAtMs - now() > 120_000) {
      log?.("info", "managed_identity.token.cache_hit", {});
      return cachedToken.accessToken;
    }
    if (!sharedRequest) {
      sharedRequest = acquire().finally(() => {
        sharedRequest = undefined;
      });
    }
    return waitForPromiseWithSignal(sharedRequest, signal, "managed_identity_auth");
  };
}
