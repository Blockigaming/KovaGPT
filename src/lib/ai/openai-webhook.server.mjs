import { readBoundedUtf8 } from "../bounded-json.server.mjs";
const supported = new Set([
  "response.completed",
  "response.failed",
  "response.cancelled",
  "response.incomplete",
  "agent.session.created",
  "agent.session.idle",
  "agent.session.failed",
  "agent.session.action_required",
]);
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export function createOpenAiWebhookHandler({ env, verify, consumeRateLimit }) {
  return async (request) => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const secret = env("OPENAI_WEBHOOK_SECRET");
    if (!secret) return json({ error: "webhook_unavailable" }, 503);
    let event;
    try {
      event = await verify(
        await readBoundedUtf8(request, 64 * 1024, request.signal),
        request.headers,
        secret,
      );
    } catch (error) {
      return json(
        { error: error?.status === 413 ? "payload_too_large" : "invalid_webhook" },
        error?.status === 413 ? 413 : 401,
      );
    }
    if (
      !event ||
      typeof event.id !== "string" ||
      !/^[A-Za-z0-9_-]{6,180}$/.test(event.id) ||
      typeof event.type !== "string"
    )
      return json({ error: "invalid_webhook" }, 400);
    if (!supported.has(event.type)) return json({ accepted: true, ignored: true });
    try {
      // Atomic durable receipt. Replays acknowledge the same event without
      // repeating effects; this receiver never executes actions from payloads.
      const receipt = await consumeRateLimit({
        identity: `openai-webhook:${event.id}`,
        action: "openai_webhook_receipt",
        limit: 1,
        windowSeconds: 604800,
      });
      if (!receipt.allowed && receipt.status !== "limited")
        return json({ error: "webhook_receipt_unavailable" }, 503);
      return json({ accepted: true, duplicate: !receipt.allowed });
    } catch {
      return json({ error: "webhook_receipt_unavailable" }, 503);
    }
  };
}
