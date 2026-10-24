import { fromJSON } from "seroval";

// PRIVATE REVIEW ONLY. Uses the existing session's Library sample identities;
// no database, pin mutation, ACL, provider, new endpoint or live read is involved.
export const PINNED_CONTEXT_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const PINNED_CONTEXT_REVIEW_CHAT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PINNED_CONTEXT_REVIEW_SOURCE_ID = "44444444-4444-4444-8444-444444444444";
export const PINNED_CONTEXT_REVIEW_PIN_ID = "74747474-7474-4474-8474-747474747474";
export const PINNED_CONTEXT_REVIEW_DISCLOSURE =
  "chat-outputs with default fixture data includes one explicitly synthetic, read-only pinned reference to its existing Library sample. Context → Chat rules and pinned files → Pinned files → Inspect displays that sample's returned name, Library origin, readiness and bounded extracted text. Choose a Library item reads the same disposable sample collection as Library; already pinned items are excluded. No pin, unpin, access change, provider call or account write is available. Reset discards this synthetic inspection.";

const origin = "http://127.0.0.1:4189";
const readMethods = {
  listChatPinnedFiles: "GET",
  resolvePinnedContext: "POST",
  listMyLibrary: "GET",
};
const writes = new Set(["pinChatFile", "unpinChatFile", "setChatPinnedFileStatus"]);
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const emptyObject = (value) => plainObject(value) && Object.keys(value).length === 0;

export function createPinnedContextReviewHandler(functionNames, { isActive, getItems } = {}) {
  if (typeof isActive !== "function" || typeof getItems !== "function")
    throw new Error(
      "Pinned inspection requires its disposable session and existing Library samples.",
    );
  for (const name of Object.keys(readMethods))
    if (![...functionNames.values()].some((value) => value.split("_")[0] === name))
      throw new Error(`The packaged pinned inspection contract is missing ${name}.`);

  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name =
      url.origin === origin && /^\/_serverFn\/[^/]+$/.test(url.pathname)
        ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
        : "";
    if (!Object.hasOwn(readMethods, name) && !writes.has(name)) return route.fallback();
    const reply = (json, status = 200) =>
      route.fulfill({
        status,
        headers: { "Cache-Control": "no-store" },
        json,
      });
    const error = (message, status) => reply({ error: message }, status);
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== PINNED_CONTEXT_REVIEW_OWNER)
    )
      return error("Synthetic pinned inspection account changed or does not match.", 401);
    if (request.signal?.()?.aborted) return error("Synthetic pinned inspection was canceled.", 499);
    if (writes.has(name))
      return error(
        "Read-only synthetic pinned inspection. Pin, unpin and status writes are unavailable.",
        503,
      );
    if (request.method() !== readMethods[name])
      return error("Use the existing read-only pinned inspection method.", 405);
    let data;
    try {
      const get = request.method() === "GET";
      if (
        get
          ? [...url.searchParams.keys()].some((key) => key !== "payload") ||
            url.searchParams.getAll("payload").length > 1 ||
            request.postData()
          : url.search
      )
        throw new Error();
      const raw = get ? url.searchParams.get("payload") : request.postData();
      if (
        raw !== null &&
        raw !== undefined &&
        (typeof raw !== "string" || Buffer.byteLength(raw) > 8192)
      )
        throw new Error();
      const envelope = raw ? fromJSON(JSON.parse(raw)) : {};
      if (
        !plainObject(envelope) ||
        Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
        (envelope.context !== undefined && !emptyObject(envelope.context))
      )
        throw new Error();
      data = envelope.data;
      if (name === "listMyLibrary") {
        if (data !== undefined && !emptyObject(data)) throw new Error();
      } else {
        const fields = name === "resolvePinnedContext" ? ["chatId", "totalChars"] : ["chatId"];
        if (
          !plainObject(data) ||
          typeof data.chatId !== "string" ||
          Object.keys(data).some((key) => !fields.includes(key)) ||
          (data.totalChars !== undefined &&
            (!Number.isInteger(data.totalChars) || data.totalChars < 1 || data.totalChars > 24000))
        )
          throw new Error();
      }
    } catch {
      return error("A bounded existing pinned inspection payload is required.", 400);
    }
    if (name !== "listMyLibrary" && data.chatId !== PINNED_CONTEXT_REVIEW_CHAT_ID)
      return error("Choose the existing synthetic Outputs review chat.", 404);
    const current = getItems();
    if (!Array.isArray(current)) return error("Synthetic Library samples are unavailable.", 503);
    const items = current
      .filter((item) => item.user_id === PINNED_CONTEXT_REVIEW_OWNER)
      .slice(0, 200);
    if (name === "listMyLibrary")
      return reply({
        result: items.map(({ user_id, metadata, ...item }) => ({
          ...structuredClone(item),
          work_output: metadata?.work_output === true,
        })),
        context: {},
      });
    const source = items.find((item) => item.id === PINNED_CONTEXT_REVIEW_SOURCE_ID);
    const sourceText = typeof source?.content_text === "string" ? source.content_text : "";
    const status = !source ? "deleted" : sourceText ? "active" : "indexing";
    const pin = {
      id: PINNED_CONTEXT_REVIEW_PIN_ID,
      chatId: PINNED_CONTEXT_REVIEW_CHAT_ID,
      sourceType: "library",
      sourceId: PINNED_CONTEXT_REVIEW_SOURCE_ID,
      projectId: null,
      status,
      createdAt: "2026-10-16T10:00:00Z",
    };
    if (name === "listChatPinnedFiles") return reply({ result: [pin], context: {} });
    const totalBudget = data.totalChars ?? 24000;
    const content = sourceText.slice(0, Math.min(8000, totalBudget));
    const truncated = content.length < sourceText.length;
    return reply({
      result: {
        items: [
          {
            pinId: pin.id,
            sourceType: pin.sourceType,
            sourceId: pin.sourceId,
            projectId: null,
            status,
            statusLabel:
              status === "active"
                ? "available"
                : status === "deleted"
                  ? "no longer exists"
                  : "still being processed",
            name: source ? source.title || source.file_name || "Library item" : "Removed item",
            content,
            truncated,
            includedChars: content.length,
          },
        ],
        usedChars: content.length,
        totalBudget,
        truncatedCount: Number(truncated),
        skippedCount: 0,
        truncated,
      },
      context: {},
    });
  };
}
