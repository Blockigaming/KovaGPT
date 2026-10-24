/** Private review only: fixed local SSE, never a provider request or prompt echo. */
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

export const REVIEW_CHAT_STREAM_HOLD_MS = 120_000;
export const REVIEW_CHAT_STREAM_MAX_REQUESTS = 32;
export const REVIEW_CHAT_STREAM_MAX_BYTES = 256 * 1024;
export const REVIEW_CHAT_STREAM_OPEN =
  "Synthetic review response. No AI provider was contacted. This response is held so you can inspect typing and Send next. ";
const event = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
export const reviewChatTextCompletion = (content) => event({ content }) + "data: [DONE]\n\n";
export const reviewChatOpeningEvent = (scenario = "chat-stream-review") =>
  scenario === "chat-response-image-review"
    ? event({ kind: "image_pending" })
    : event({ content: REVIEW_CHAT_STREAM_OPEN });
export function reviewChatCompletionEvent(outcome, scenario = "chat-stream-review") {
  if (scenario === "chat-response-image-review")
    return (
      event({
        content:
          outcome === "released"
            ? `![Synthetic local landscape sample](${REVIEW_CHAT_IMAGE_SAMPLES.landscape.dataUrl})`
            : outcome === "timeout"
              ? "Sorry - Synthetic image review hold expired. Reset to inspect again; no image provider was contacted."
              : "Sorry - Image generation failed. Please try a different prompt or try again later.",
      }) + "data: [DONE]\n\n"
    );
  if (outcome === "released")
    return (
      event({ content: "Synthetic completion released from the review controls." }) +
      "data: [DONE]\n\n"
    );
  return event({
    kind: "error",
    code: outcome === "timeout" ? "private_review_chat_timeout" : "private_review_chat_failed",
    error:
      outcome === "timeout"
        ? "Synthetic review hold expired. Reset or retry the local sample; no provider was contacted."
        : "Synthetic review failure. No provider was contacted.",
    status: 503,
    retryable: false,
    category: "model_provider_failure",
  });
}

/** Accept only bounded ordinary text chat. All profile/context fields are ignored. */
export function validReviewChatBody(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.chatId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(value.chatId) &&
    ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"].includes(value.mode) &&
    !value.clientTool &&
    !value.skill &&
    !value.kova &&
    !value.projectId &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.length <= 100 &&
    value.messages.every(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.length <= 50_000 &&
        (message.attachments === undefined ||
          (Array.isArray(message.attachments) && message.attachments.length === 0)) &&
        !message.tool_calls,
    ) &&
    value.messages.at(-1).role === "user" &&
    value.messages.at(-1).content.trim(),
  );
}

/** Own exactly one active response and one last receipt per disposable session. */
export function createReviewChatStream({ isActive, clock = { setTimeout, clearTimeout } }) {
  let active = null,
    last = null,
    count = 0,
    disposed = false;
  const finish = (entry, outcome) => {
    if (active !== entry) return;
    active = null;
    clock.clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.abort);
    last = { id: entry.id, outcome, sequence: entry.sequence };
    entry.resolve(outcome);
  };
  return {
    get status() {
      return {
        syntheticOnly: true,
        active: active ? { id: active.id, sequence: active.sequence } : null,
        last: last ? { ...last } : null,
        requestCount: count,
      };
    },
    start(signal) {
      if (disposed || !isActive())
        return { error: "Synthetic review account unavailable.", status: 401 };
      if (signal?.aborted) return { error: "Synthetic review request canceled.", status: 499 };
      if (active)
        return {
          error: "One synthetic stream at a time. Finish or Stop the current response.",
          status: 409,
        };
      if (count >= REVIEW_CHAT_STREAM_MAX_REQUESTS)
        return { error: "Synthetic stream limit reached. Reset review controls.", status: 429 };
      let resolve;
      const completion = new Promise((done) => {
        resolve = done;
      });
      const entry = {
        id: randomUUID(),
        sequence: ++count,
        signal,
        resolve,
        timer: undefined,
        abort: null,
      };
      entry.abort = () => finish(entry, "aborted");
      active = entry;
      signal?.addEventListener("abort", entry.abort, { once: true });
      entry.timer = clock.setTimeout(() => finish(entry, "timeout"), REVIEW_CHAT_STREAM_HOLD_MS);
      entry.timer?.unref?.();
      return { id: entry.id, completion };
    },
    complete(id, outcome) {
      if (disposed || !isActive()) return false;
      if (!["released", "failed"].includes(outcome)) return false;
      // Repeating an old controller submit never completes a newer queued turn.
      if (last?.id === id) return last.outcome === outcome;
      if (!active || active.id !== id) return false;
      finish(active, outcome);
      return true;
    },
    dispose() {
      disposed = true;
      if (active) finish(active, "disposed");
    },
  };
}

export const REVIEW_CHAT_RESPONSE_OPTIONS = Object.freeze(
  [
    "chat-session-rejected",
    "chat-retry-backoff",
    "chat-message-quota-rejected",
    "chat-message-quota-pending",
  ].map((id) =>
    Object.freeze({
      id,
      accounts: Object.freeze(
        id.startsWith("chat-message-quota-") ? ["free"] : ["free", "plus", "pro"],
      ),
      path: "/",
    }),
  ),
);
export const REVIEW_CHAT_RESPONSE_SCENARIOS = Object.freeze(
  REVIEW_CHAT_RESPONSE_OPTIONS.map(({ id }) => id),
);
export const REVIEW_CHAT_RETRY_AFTER_SECONDS = 5;
export const REVIEW_CHAT_QUOTA_HOLD_MS = 10_000;
export const REVIEW_CHAT_RESPONSE_DISCLOSURE =
  "Private chat response inspection only. chat-session-rejected returns an authoritative HTTP 401 with authentication_required and retryable false, without changing the synthetic account or invoking authentication. chat-retry-backoff returns HTTP 503 with Retry-After: 5 and retryable true on its first valid text request; early retries receive the remaining delay, and requests after the deadline receive fixed synthetic SSE success. The actual app owns its countdown and automatic retry. chat-message-quota-rejected is Free-only and returns HTTP 429 with quota_exceeded and retryable false; it provides no quota-reset time or entitlement claim. Check Usage is the next-step copy, not a synthetic reset promise. chat-message-quota-pending returns that same rejection after a fixed 10-second local inspection hold so the reviewer can type a later draft; that delay is not a real quota reset or Retry-After. Only one pending request is held; abort, reset and sign-out cancel its timer. Reset re-arms the local sequence. No prompt is echoed, provider is called, or live session changed. Existing stream Fail stays nonretryable. Chat-history writes retain their existing metadata-only limits.";

/** Inert responses; only the explicit pending quota sample owns one bounded local timer. */
export function createReviewChatResponse({
  scenario,
  isActive,
  now = Date.now,
  clock = { setTimeout, clearTimeout },
}) {
  if (
    !REVIEW_CHAT_RESPONSE_SCENARIOS.includes(scenario) ||
    typeof isActive !== "function" ||
    typeof now !== "function"
  )
    throw new Error("Known synthetic chat response scenario and active session required.");
  let disposed = false,
    count = 0,
    readyAt = null,
    pending = null;
  const json = (status, body, headers = {}) => ({
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Kova-Review-Only": "synthetic-chat-response",
      ...headers,
    },
    json: body,
  });
  const quota = () =>
    json(429, {
      error: "Synthetic message limit reached. Check Usage for account status.",
      category: "quota_exceeded",
      retryable: false,
    });
  return {
    get status() {
      return { syntheticOnly: true, requestCount: count, pending: Boolean(pending) };
    },
    respond(signal) {
      if (disposed || !isActive())
        return json(401, {
          error: "Synthetic review account unavailable.",
          code: "authentication_required",
          retryable: false,
        });
      if (signal?.aborted)
        return json(499, { error: "Synthetic review request canceled.", retryable: false });
      if (pending)
        return json(409, { error: "One synthetic quota request at a time.", retryable: false });
      if (count >= REVIEW_CHAT_STREAM_MAX_REQUESTS)
        return json(429, {
          error: "Synthetic response limit reached. Reset review controls.",
          retryable: false,
        });
      count += 1;
      if (scenario === "chat-session-rejected")
        return json(401, {
          error: "Synthetic session rejection. No authentication service was contacted.",
          code: "authentication_required",
          retryable: false,
        });
      if (scenario === "chat-message-quota-rejected") return quota();
      if (scenario === "chat-message-quota-pending")
        return new Promise((resolve) => {
          const entry = { timer: null, finish: null };
          const canceled = () =>
            json(499, { error: "Synthetic quota inspection canceled.", retryable: false });
          const abort = () => entry.finish(canceled());
          entry.finish = (result) => {
            if (pending !== entry) return;
            pending = null;
            clock.clearTimeout(entry.timer);
            signal?.removeEventListener("abort", abort);
            resolve(result);
          };
          pending = entry;
          signal?.addEventListener("abort", abort, { once: true });
          entry.timer = clock.setTimeout(
            () => entry.finish(disposed || !isActive() ? canceled() : quota()),
            REVIEW_CHAT_QUOTA_HOLD_MS,
          );
          entry.timer?.unref?.();
        });
      const time = now();
      if (readyAt === null) readyAt = time + REVIEW_CHAT_RETRY_AFTER_SECONDS * 1000;
      if (time < readyAt) {
        const seconds = Math.min(
          REVIEW_CHAT_RETRY_AFTER_SECONDS,
          Math.max(1, Math.ceil((readyAt - time) / 1000)),
        );
        return json(
          503,
          {
            error:
              "Synthetic temporary chat failure. The actual app may retry after the disclosed delay; no provider was contacted.",
            code: "private_review_chat_retry",
            category: "model_provider_failure",
            retryable: true,
          },
          { "Retry-After": String(seconds) },
        );
      }
      return {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Kova-Review-Only": "synthetic-chat-response" },
        contentType: "text/event-stream; charset=utf-8",
        body:
          event({
            content:
              "Synthetic retry completed after the local backoff. No AI provider was contacted.",
          }) + "data: [DONE]\n\n",
      };
    },
    dispose() {
      disposed = true;
      pending?.finish(
        json(499, { error: "Synthetic quota inspection canceled.", retryable: false }),
      );
    },
  };
}

export const REVIEW_CHAT_INSPECTION_OPTIONS = Object.freeze(
  ["chat-response-image-review", "chat-action-partial-review", "chat-writing-result-review"].map(
    (id) => Object.freeze({ id, accounts: Object.freeze(["free", "plus", "pro"]), path: "/" }),
  ),
);
export const REVIEW_CHAT_IMAGE_DISCLOSURE =
  "chat-response-image-review uses only two fixed synthetic PNGs generated locally: portrait 360 × 640 and landscape 640 × 360. Its seeded portrait and released Markdown use the actual response-image renderer. A bounded plain-text request emits the actual image_pending SSE event, then waits for explicit Release or Fail; Fail returns the actual image-producer failure prose and [DONE]. Use the app’s actual Stop while pending for cancellation. Save to Library is disconnected; inspect Save/Download placement without treating visibility as a successful save. No prompt is echoed, image provider called, account storage written, or remote image fetched.";
export const REVIEW_CHAT_ACTION_DISCLOSURE =
  "chat-action-partial-review contains two fictional Gmail draft proposals for .invalid accounts and recipients. A is a seeded confirmed presentation only. B alone accepts the existing owner-bound confirm/cancel contract: first Confirm returns a synthetic reconnect error; explicit Retry completes only B locally; Cancel cancels only B locally. No Google connection, draft, email, export or provider operation occurs. The session retains only a bounded request count and B status, resets on controller reset, and refuses all other action IDs.";
export const REVIEW_CHAT_WRITING_DISCLOSURE =
  "chat-writing-result-review contains a fictional local writing sample and a separate static HTML sample. The long Markdown exercises the actual writing Result; the HTML has no scripts or network resources and is displayed only when the reviewer explicitly chooses Run. Export and download controls are not invoked automatically. No account content, live website or external publishing is involved.";

// Deterministic code-drawn PNG fixtures, not provider images. Fixed dimensions,
// three color channels, no metadata, links, text payloads, files or network reads.
function syntheticPng(width, height) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([length, type, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sun = (x / width - 0.68) ** 2 + (y / height - 0.28) ** 2 < 0.012;
      const color = sun
        ? [239, 185, 110]
        : y > height * 0.7
          ? [57, 91, 82]
          : y > height * 0.54
            ? [115, 146, 126]
            : [220, 230, 216];
      const offset = y * (width * 3 + 1) + x * 3 + 1;
      pixels.set(color, offset);
    }
  }
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64")}`;
}
export const REVIEW_CHAT_IMAGE_SAMPLES = Object.freeze({
  landscape: Object.freeze({ width: 640, height: 360, dataUrl: syntheticPng(640, 360) }),
  portrait: Object.freeze({ width: 360, height: 640, dataUrl: syntheticPng(360, 640) }),
});

export const REVIEW_CHAT_ACTION_OWNER = "22222222-2222-4222-8222-222222222222";
export const REVIEW_CHAT_ACTION_A = "adaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const REVIEW_CHAT_ACTION_B = "adbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const REVIEW_CHAT_ACTION_RECONNECT = "Synthetic reconnect required; no draft was saved.";
export const REVIEW_CHAT_ACTION_SUCCESS =
  "Synthetic draft completed locally; no Google account was changed.";
export function reviewChatActionConfirmations() {
  return [
    {
      actionId: REVIEW_CHAT_ACTION_A,
      tool: "gmail_create_draft",
      summary:
        "A · Fictional draft to completed@example.invalid. Seeded local result only; no draft was saved.",
      argsPreview: {
        google_account: "review@example.invalid",
        connection_id: "acaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        to: "completed@example.invalid",
        subject: "Synthetic completed draft A",
        body_preview:
          "Fictional local review only. This is a seeded presentation, not a sent or saved draft.",
      },
      status: "confirmed",
      resultText: "Synthetic A shown as complete; no Google account was changed.",
    },
    {
      actionId: REVIEW_CHAT_ACTION_B,
      tool: "gmail_create_draft",
      summary:
        "B · Propose a fictional draft to pending@example.invalid in review@example.invalid. Confirm and Retry affect only this local sample; no Gmail draft is saved.",
      argsPreview: {
        google_account: "review@example.invalid",
        connection_id: "acbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        to: "pending@example.invalid",
        subject: "Synthetic pending draft B",
        body_preview:
          "Fictional local review only. Inspect failure, explicit Retry, and Cancel without contacting Google.",
      },
      status: "pending",
    },
  ];
}

/** Exactly one fixed synthetic action: no arbitrary IDs, args, service or history writes. */
export function createReviewChatAction({ isActive }) {
  if (typeof isActive !== "function") throw new Error("An active synthetic session is required.");
  let count = 0,
    status = "pending",
    disposed = false;
  const reply = (json, code = 200) => ({
    status: code,
    headers: { "Cache-Control": "no-store", "X-Kova-Review-Only": "synthetic-chat-action" },
    json,
  });
  return {
    get status() {
      return { syntheticOnly: true, actionId: REVIEW_CHAT_ACTION_B, status, requestCount: count };
    },
    async handler(route) {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4189" || url.pathname !== "/api/chat/confirm")
        return route.fallback();
      const error = (message, code) => route.fulfill(reply({ ok: false, error: message }, code));
      if (disposed || !isActive() || request.headers()["x-kova-owner"] !== REVIEW_CHAT_ACTION_OWNER)
        return error("Synthetic action account does not match.", 401);
      if (request.signal?.()?.aborted) return error("Synthetic action canceled.", 499);
      if (request.method() !== "POST") return error("Synthetic action requires POST.", 405);
      let body;
      try {
        const raw = request.postData();
        if (
          url.search ||
          !/^application\/json(?:;|$)/i.test(request.headers()["content-type"] ?? "") ||
          typeof raw !== "string" ||
          Buffer.byteLength(raw) > 4096
        )
          throw new Error();
        body = JSON.parse(raw);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 2 ||
          Object.keys(body).some((key) => !["action_id", "decision"].includes(key)) ||
          !["confirm", "cancel"].includes(body.decision) ||
          typeof body.action_id !== "string"
        )
          throw new Error();
      } catch {
        return error("A bounded existing confirmation payload is required.", 400);
      }
      if (body.action_id !== REVIEW_CHAT_ACTION_B)
        return error("Only synthetic pending action B is available.", 404);
      if (count >= REVIEW_CHAT_STREAM_MAX_REQUESTS)
        return error("Synthetic action limit reached. Reset review controls.", 429);
      count += 1;
      if (status === "confirmed" || status === "cancelled") {
        if ((status === "confirmed") !== (body.decision === "confirm"))
          return error(
            "This synthetic action already has a terminal result. Reset to inspect again.",
            409,
          );
      } else if (body.decision === "cancel") status = "cancelled";
      else if (status === "pending") {
        status = "failed";
        return error(REVIEW_CHAT_ACTION_RECONNECT, 400);
      } else status = "confirmed";
      return route.fulfill(
        reply({
          ok: true,
          result_text:
            status === "confirmed"
              ? REVIEW_CHAT_ACTION_SUCCESS
              : "Synthetic B cancelled locally; no Google account was changed.",
        }),
      );
    },
    dispose() {
      disposed = true;
    },
  };
}
