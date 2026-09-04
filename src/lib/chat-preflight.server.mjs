const DEFAULT_REQUIRED_TIMEOUT_MS = 10_000;
const DEFAULT_OPTIONAL_TIMEOUT_MS = 2_500;
const DEFAULT_TOTAL_TIMEOUT_MS = 25_000;

function positiveTimeout(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("timeout must be a positive finite number");
  }
  return Math.floor(value);
}

function safeStage(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,79}$/u.test(value)) {
    throw new TypeError("invalid chat preflight stage");
  }
  return value;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("chat_request_aborted");
  error.name = "AbortError";
  return error;
}

function metadataFromError(error) {
  if (!error || typeof error !== "object") return {};
  const source = error;
  const status =
    Number.isSafeInteger(source.status) && source.status >= 400 && source.status <= 599
      ? source.status
      : undefined;
  return {
    code: typeof source.code === "string" && source.code ? source.code : undefined,
    status,
    retryable: typeof source.retryable === "boolean" ? source.retryable : undefined,
  };
}

export class ChatPreflightError extends Error {
  constructor({ stage, code, status, retryable, cause }) {
    const publicMessage =
      status === 499
        ? "The request was cancelled."
        : status === 504
          ? "KovaGPT took too long to prepare this request. Please try again."
          : "KovaGPT could not prepare this request. Please try again.";
    super(publicMessage, cause === undefined ? undefined : { cause });
    this.name = "ChatPreflightError";
    this.stage = stage;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  toEnvelope() {
    return {
      error: this.message,
      code: this.code,
      category: "server",
      retryable: this.retryable,
      stage: this.stage,
    };
  }
}

function normalizedFailure(stage, error, { timedOut, parentAborted, totalTimedOut }) {
  if (error instanceof ChatPreflightError) return error;
  if (parentAborted) {
    return new ChatPreflightError({
      stage,
      code: "chat_request_aborted",
      status: 499,
      retryable: false,
      cause: error,
    });
  }
  if (timedOut || totalTimedOut) {
    return new ChatPreflightError({
      stage,
      code: "chat_preflight_timeout",
      status: 504,
      retryable: true,
      cause: error,
    });
  }
  const metadata = metadataFromError(error);
  const status = metadata.status ?? 503;
  return new ChatPreflightError({
    stage,
    code: metadata.code ?? "chat_preflight_failed",
    status,
    retryable: metadata.retryable ?? (status === 408 || status === 429 || status >= 500),
    cause: error,
  });
}

export function createChatPreflightRunner({
  signal,
  requiredTimeoutMs = DEFAULT_REQUIRED_TIMEOUT_MS,
  optionalTimeoutMs = DEFAULT_OPTIONAL_TIMEOUT_MS,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  onMilestone,
  now = Date.now,
} = {}) {
  const requiredLimit = positiveTimeout(requiredTimeoutMs, DEFAULT_REQUIRED_TIMEOUT_MS);
  const optionalLimit = positiveTimeout(optionalTimeoutMs, DEFAULT_OPTIONAL_TIMEOUT_MS);
  const totalLimit = positiveTimeout(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const startedAt = now();
  let totalTimedOut = false;
  let closed = false;
  const totalController = new AbortController();
  const onParentAbort = () => {
    if (!totalController.signal.aborted) totalController.abort(abortError(signal));
  };
  if (signal?.aborted) onParentAbort();
  else signal?.addEventListener("abort", onParentAbort, { once: true });
  const totalTimer = setTimeout(() => {
    totalTimedOut = true;
    if (!totalController.signal.aborted) {
      totalController.abort(new Error("chat_preflight_total_timeout"));
    }
  }, totalLimit);

  const emit = (event) => {
    try {
      onMilestone?.(event);
    } catch {
      // Observability must never alter request behavior.
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", onParentAbort);
  };

  return {
    async run(stageValue, operation, { required = true, timeoutMs } = {}) {
      if (closed) throw new Error("chat_preflight_runner_closed");
      if (typeof operation !== "function") throw new TypeError("operation must be a function");
      const stage = safeStage(stageValue);
      const stageStartedAt = now();
      const stageLimit = positiveTimeout(timeoutMs, required ? requiredLimit : optionalLimit);
      const stageController = new AbortController();
      let stageTimedOut = false;
      const onTotalAbort = () => {
        if (!stageController.signal.aborted) {
          stageController.abort(abortError(totalController.signal));
        }
      };
      if (totalController.signal.aborted) onTotalAbort();
      else totalController.signal.addEventListener("abort", onTotalAbort, { once: true });
      const stageTimer = setTimeout(() => {
        stageTimedOut = true;
        if (!stageController.signal.aborted) {
          stageController.abort(new Error("chat_preflight_stage_timeout"));
        }
      }, stageLimit);

      emit({
        stage,
        state: "started",
        required,
        durationMs: Math.max(0, now() - startedAt),
      });

      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(abortError(stageController.signal));
        if (stageController.signal.aborted) {
          onAbort();
          return;
        }
        stageController.signal.addEventListener("abort", onAbort, { once: true });
      });
      const task = stageController.signal.aborted
        ? new Promise(() => {})
        : Promise.resolve().then(() => operation(stageController.signal));

      try {
        const value = await Promise.race([task, aborted]);
        emit({
          stage,
          state: "completed",
          required,
          durationMs: Math.max(0, now() - stageStartedAt),
        });
        return value;
      } catch (error) {
        const parentAborted = Boolean(signal?.aborted);
        const failure = normalizedFailure(stage, error, {
          timedOut: stageTimedOut,
          parentAborted,
          totalTimedOut,
        });
        emit({
          stage,
          state:
            failure.status === 499
              ? "aborted"
              : failure.code === "chat_preflight_timeout"
                ? "timed_out"
                : "failed",
          required,
          durationMs: Math.max(0, now() - stageStartedAt),
          code: failure.code,
          status: failure.status,
        });
        if (!required && !parentAborted && !totalTimedOut) return undefined;
        throw failure;
      } finally {
        clearTimeout(stageTimer);
        totalController.signal.removeEventListener("abort", onTotalAbort);
        if (onAbort) stageController.signal.removeEventListener("abort", onAbort);
      }
    },
    close,
  };
}
