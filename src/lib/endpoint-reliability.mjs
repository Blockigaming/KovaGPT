export const MEMORY_LIMITS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxMessages: 30,
  maxContentChars: 2_000,
  maxChatIdChars: 100,
  maxTitleChars: 120,
});

export class DurableBackendError extends Error {
  constructor(operation) {
    super(`${operation} failed`);
    this.name = "DurableBackendError";
    this.operation = operation;
  }
}

export function assertDatabaseSuccess(result, operation) {
  if (!result || result.error) throw new DurableBackendError(operation);
  return result.data;
}

export function parseMemoryPayload(raw) {
  if (typeof raw !== "string" || raw.length > MEMORY_LIMITS.maxBodyBytes) {
    return { ok: false, status: 413, error: "Request too large." };
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const title =
    body.title == null ? null : typeof body.title === "string" ? body.title.trim() : null;
  if (
    !chatId ||
    chatId.length > MEMORY_LIMITS.maxChatIdChars ||
    (body.title != null && title === null) ||
    (title?.length ?? 0) > MEMORY_LIMITS.maxTitleChars ||
    !Array.isArray(body.messages) ||
    body.messages.length < 4 ||
    body.messages.length > MEMORY_LIMITS.maxMessages
  ) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  const messages = [];
  for (const item of body.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, status: 400, error: "Invalid message payload" };
    }
    if (item.role !== "user" && item.role !== "assistant") {
      return { ok: false, status: 400, error: "Invalid message role" };
    }
    if (
      typeof item.content !== "string" ||
      !item.content.trim() ||
      item.content.length > MEMORY_LIMITS.maxContentChars
    ) {
      return { ok: false, status: 400, error: "Invalid message content" };
    }
    messages.push({ role: item.role, content: item.content });
  }

  return { ok: true, value: { chatId, title: title || null, messages } };
}

export async function persistMemorySafely({ upsert, listOverflow, deleteOverflow }) {
  assertDatabaseSuccess(await upsert(), "memory_upsert");
  if (!listOverflow) return;

  const overflow = assertDatabaseSuccess(await listOverflow(), "memory_prune_lookup");
  if (!Array.isArray(overflow) || overflow.length === 0) return;
  assertDatabaseSuccess(await deleteOverflow(overflow), "memory_prune_delete");
}

export async function suppressThenConsumeToken({ alreadyUsed, suppress, consume }) {
  assertDatabaseSuccess(await suppress(), "unsubscribe_suppression");
  if (!alreadyUsed) assertDatabaseSuccess(await consume(), "unsubscribe_token_update");
}

export function unsubscribeLinkState({ alreadyUsed, suppressionResult }) {
  if (!alreadyUsed) return { valid: true };
  const suppression = assertDatabaseSuccess(suppressionResult, "unsubscribe_suppression_lookup");
  return suppression ? { valid: false, reason: "already_unsubscribed" } : { valid: true };
}

export function retryableUnavailable(error) {
  return Response.json(
    { error },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    },
  );
}

export function financeQueueUnavailableResponse() {
  return retryableUnavailable("webhook_queue_unavailable");
}
