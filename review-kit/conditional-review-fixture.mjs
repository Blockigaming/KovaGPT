/** Private finite C02/P21 read scenarios. No production imports or live operations. */
const origin = "http://127.0.0.1:4189";
export const CONDITIONAL_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const HISTORY_RECOVERY_HOLD_MS = 10_000;
const maxPending = 64;
export const CONDITIONAL_REVIEW_OPTIONS = Object.freeze([
  Object.freeze({
    id: "chat-history-recovery",
    label: "chat-history-recovery · one idle failure, then 10-second read recovery",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: "/",
  }),
  Object.freeze({
    id: "developer-console-empty",
    label: "developer-console-empty · disabled, owner-bound empty read",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: "/developers/console",
  }),
]);
export const CONDITIONAL_REVIEW_SCENARIOS = Object.freeze(
  CONDITIONAL_REVIEW_OPTIONS.map(({ id }) => id),
);
export const CONDITIONAL_REVIEW_DISCLOSURE =
  "chat-history-recovery first returns the existing seeded history pages unchanged, fails one subsequent idle GET with a synthetic 503, then holds the next valid GET for about 10 seconds before reading the same local fixture again. Existing device data and metadata-only writes are unchanged. The real app owns Offline, Retry, syncing and saved presentation; no status text is injected. With no pending changes, the app normally polls every 15 seconds, so use the actual Retry before its next poll to inspect user-triggered recovery; an automatic poll is not evidence of a Retry click. developer-console-empty permits only the synthetic owner's first-page GET and returns enabled:false with empty accounts, projects, keys, limits, usage and balances. Developer mutations, keys, funding and files remain disconnected. No real chat synchronization, developer workspace, key, charge or provider operation occurs. Reset/sign-out cancels pending reads and re-arms the selected scenario.";
const response = (status, message) => ({
  status,
  headers: { "Cache-Control": "no-store" },
  json: { error: message },
});

/** Only the exact first-page GET is supported; all mutation routing stays unchanged. */
export function createDeveloperConsoleReviewHandler({ isActive } = {}) {
  if (typeof isActive !== "function") throw new Error("Active synthetic console session required.");
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.origin !== origin ||
      url.pathname !== "/api/developer/console" ||
      request.method() !== "GET"
    )
      return route.fallback();
    const headers = request.headers();
    if (
      !isActive() ||
      headers["x-kova-expected-user"] !== CONDITIONAL_REVIEW_OWNER ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== CONDITIONAL_REVIEW_OWNER)
    )
      return route.fulfill(
        response(401, "Synthetic developer account does not match this review session."),
      );
    if (request.signal?.()?.aborted)
      return route.fulfill(response(499, "Synthetic developer read canceled."));
    if (
      request.postData() ||
      [...url.searchParams.keys()].some((key) => key !== "limitsPage") ||
      url.searchParams.getAll("limitsPage").length > 1 ||
      (url.searchParams.has("limitsPage") && url.searchParams.get("limitsPage") !== "0")
    )
      return route.fulfill(
        response(400, "Only the existing synthetic empty limits page 0 is available."),
      );
    return route.fulfill({
      status: 200,
      headers: { "Cache-Control": "no-store" },
      json: {
        enabled: false,
        accounts: [],
        projects: [],
        keys: [],
        limits: [],
        usage: [],
        balances: [],
        limitsPage: 0,
        limitsHasMore: false,
      },
    });
  };
}

/** Wrap the one existing seeded handler, preserving its validation and response DTO.
 * Valid GETs are side-effect-free, so re-read after the hold to preserve newer
 * accepted metadata changes. No request body, authored content or status is stored.
 */
export function createChatHistoryRecovery({
  handler,
  isActive,
  clock = { setTimeout, clearTimeout },
} = {}) {
  if (typeof handler !== "function" || typeof isActive !== "function")
    throw new Error("Seeded history handler and active session required.");
  let phase = "initial",
    disposed = false;
  const pending = new Set();
  const wait = (signal) => {
    if (disposed || signal?.aborted) return Promise.resolve("canceled");
    if (pending.size >= maxPending) return Promise.resolve("capacity");
    return new Promise((resolve) => {
      let timer;
      const finish = (reason) => {
        if (!pending.delete(finish)) return;
        clock.clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(reason);
      };
      const abort = () => finish("canceled");
      pending.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
      timer = clock.setTimeout(() => finish("complete"), HISTORY_RECOVERY_HOLD_MS);
      timer?.unref?.();
    });
  };
  return {
    get pendingCount() {
      return pending.size;
    },
    dispose() {
      disposed = true;
      for (const finish of [...pending]) finish("canceled");
    },
    async handler(route) {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin || url.pathname !== "/api/chat/history") return route.fallback();
      if (disposed || !isActive())
        return route.fulfill(response(401, "Synthetic history review session ended."));
      if (request.method() !== "GET") return handler(route);
      // Let the existing fixture validate owner, epoch and cursor first. Invalid
      // requests never consume the one-shot idle failure or arm a delay.
      let output;
      await handler({
        ...route,
        fulfill: async (value) => {
          output = value;
        },
      });
      if (!output) return;
      const page = output.json;
      if (
        (output.status ?? 200) !== 200 ||
        page?.ownerId !== CONDITIONAL_REVIEW_OWNER ||
        !Array.isArray(page.records)
      )
        return route.fulfill(output);
      if (request.signal?.()?.aborted)
        return route.fulfill(response(499, "Synthetic history read canceled."));
      if (phase === "initial") {
        if (page.hasMore === false) phase = "armed";
        return route.fulfill(output);
      }
      if (phase === "armed") {
        if (page.reset === false && page.hasMore === false && page.records.length === 0) {
          phase = "failed";
          return route.fulfill(
            response(
              503,
              "Synthetic idle history read failed once. Use the app's Retry; no live synchronization occurred.",
            ),
          );
        }
        return route.fulfill(output);
      }
      if (phase === "failed" || phase === "holding") {
        phase = "holding";
        const reason = await wait(request.signal?.());
        if (disposed || !isActive())
          return route.fulfill(response(401, "Synthetic history review session ended."));
        if (reason !== "complete") {
          if (phase !== "recovered" && !pending.size) phase = "failed";
          return route.fulfill(
            response(
              reason === "capacity" ? 503 : 499,
              reason === "capacity"
                ? "Synthetic history pending read limit reached."
                : "Synthetic history read canceled.",
            ),
          );
        }
        phase = "recovered";
        return handler(route);
      }
      return route.fulfill(output);
    },
  };
}
