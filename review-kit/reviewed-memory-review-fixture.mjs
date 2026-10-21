import { fromJSON } from "seroval";
import {
  parseReviewedMemoryRequest,
  reviewedMemorySource,
} from "../src/lib/reviewed-memory-policy.mjs";

// This adapter stores only one explicitly reviewed synthetic text in this session.
export const REVIEWED_MEMORY_OWNER = "22222222-2222-4222-8222-222222222222";
export const REVIEWED_MEMORY_CHAT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc42";
export const REVIEWED_MEMORY_RECORD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd42";
export const REVIEWED_MEMORY_TIME = "2026-10-19T00:00:00.000Z";
export const REVIEWED_MEMORY_OPTIONS = Object.freeze(
  ["save", "rejected", "uncertain"].map((outcome) =>
    Object.freeze({
      id: `chat-reviewed-memory-${outcome}`,
      label: `chat-reviewed-memory-${outcome} · explicit text, disposable local memory`,
      accounts: Object.freeze(["plus", "pro"]),
      path: "/",
    }),
  ),
);
export const REVIEWED_MEMORY_SCENARIOS = Object.freeze(REVIEWED_MEMORY_OPTIONS.map(({ id }) => id));
export const REVIEWED_MEMORY_DISCLOSURE =
  "Reviewed-memory scenarios add one fictional four-message chat, received through the ordinary local history fixture at revision 1. Wait for history to finish loading; explicitly enable Use saved memory in the app Settings, then use the assistant response menu → Save a reviewed memory. The dialog starts blank and still requires exact text and confirmation. Cancel makes no request. The save scenario retains only that exact text in disposable session memory, visible in Memory Center; rejected returns 400 and uncertain returns 503 with no local commit. Both failure outcomes remain failures on Retry. No real account memory, provider, cloud sync or privacy setting is changed. Reset, account replacement and logout discard the local record. The ordinary two-message sample remains ineligible. Existing history rename/archive changes advance its revision and stale saves fail. Memory editing/deletion and context summaries are disconnected; use Reset to clear this fixture.";
export function reviewedMemoryConversation() {
  return {
    id: REVIEWED_MEMORY_CHAT_ID,
    title: "Fictional reviewed-memory sample",
    mode: "instant",
    createdAt: 1792238400000,
    updatedAt: 1792238400000,
    messages: [
      {
        id: "reviewed-memory-user-1",
        role: "user",
        content: "For this fictional local review, outline a quiet studio routine.",
      },
      {
        id: "reviewed-memory-assistant-1",
        role: "assistant",
        content:
          "Fictional example: prepare the workspace, read one sample, and take a short break.",
      },
      {
        id: "reviewed-memory-user-2",
        role: "user",
        content: "Keep this sample routine short. Do not infer or save a real personal preference.",
      },
      {
        id: "reviewed-memory-assistant-2",
        role: "assistant",
        content:
          "This is a four-message synthetic sample. Open Save a reviewed memory to type and confirm your own review-only text. Nothing is saved by opening or canceling the dialog.",
      },
    ],
  };
}
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function emptyListInput(request, url) {
  if (
    request.postData() ||
    [...url.searchParams.keys()].some((key) => key !== "payload") ||
    url.searchParams.getAll("payload").length > 1
  )
    return false;
  const raw = url.searchParams.get("payload");
  if (raw === null) return true;
  if (!raw || Buffer.byteLength(raw) > 8192) return false;
  try {
    const input = fromJSON(JSON.parse(raw));
    return (
      plain(input) &&
      Object.keys(input).every((key) => ["data", "context"].includes(key)) &&
      [input.data, input.context].every(
        (value) => value === undefined || (plain(value) && Object.keys(value).length === 0),
      )
    );
  } catch {
    return false;
  }
}
export function createReviewedMemoryReviewFixture(
  scenario,
  functionNames,
  { account, isActive, getHistoryRecord } = {},
) {
  if (
    !REVIEWED_MEMORY_SCENARIOS.includes(scenario) ||
    !["plus", "pro"].includes(account) ||
    !(functionNames instanceof Map) ||
    typeof isActive !== "function" ||
    typeof getHistoryRecord !== "function"
  )
    throw new Error("Paid synthetic session and existing history contract required.");
  const names = new Map(functionNames);
  if (![...names.values()].some((value) => value.split("_")[0] === "listMemoryCenter"))
    throw new Error("Packaged Memory Center read contract is missing.");
  let saved = null,
    disposed = false;
  return {
    dispose() {
      disposed = true;
      saved = null;
    },
    handler(route) {
      const request = route.request(),
        url = new URL(request.url());
      const name =
        url.origin === "http://127.0.0.1:4189" && /^\/_serverFn\/[^/]+$/.test(url.pathname)
          ? (names.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
          : "";
      const api = url.origin === "http://127.0.0.1:4189" && url.pathname === "/api/memory";
      if (!api && !["listMemoryCenter", "updateMemoryRecord", "deleteMemoryRecord"].includes(name))
        return route.fallback();
      const reply = (status, value) =>
        route.fulfill({ status, headers: { "Cache-Control": "no-store" }, json: value });
      const error = (status, message) => reply(status, { error: message });
      const owner = request.headers()["x-kova-owner"];
      if (
        disposed ||
        isActive() !== true ||
        (api
          ? owner !== REVIEWED_MEMORY_OWNER
          : owner !== undefined && owner !== REVIEWED_MEMORY_OWNER)
      )
        return error(401, "Synthetic reviewed-memory account does not match.");
      if (request.signal?.()?.aborted)
        return error(499, "Synthetic reviewed-memory request canceled.");
      if (!api) {
        if (name !== "listMemoryCenter")
          return error(
            503,
            "Synthetic memory editing/deletion is disconnected. Reset the review to clear it.",
          );
        if (request.method() !== "GET") return error(405, "Synthetic Memory Center is read-only.");
        if (!emptyListInput(request, url))
          return error(400, "Use the exact empty Memory Center read payload.");
        return reply(200, {
          result: saved
            ? [
                {
                  id: REVIEWED_MEMORY_RECORD_ID,
                  content: saved.summary,
                  title: saved.title,
                  source: "conversation",
                  category: "Conversation summary",
                  updatedAt: saved.updated_at,
                },
              ]
            : [],
          context: {},
        });
      }
      if (url.search)
        return error(
          400,
          "Only the reviewed-memory list/save contract is connected; context summaries are unavailable.",
        );
      if (request.method() === "GET") {
        if (request.postData()) return error(400, "Memory reads do not accept a body.");
        return reply(200, { memories: saved ? [structuredClone(saved)] : [] });
      }
      if (request.method() !== "POST")
        return error(
          405,
          "Only explicit reviewed-memory save is available; reset to clear the sample.",
        );
      const raw = request.postData() ?? "";
      if (Buffer.byteLength(raw) > 8192)
        return error(413, "Synthetic reviewed-memory payload is too large.");
      if (
        (request.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase() !==
        "application/json"
      )
        return error(415, "Reviewed-memory save requires application/json.");
      let input;
      try {
        input = parseReviewedMemoryRequest(JSON.parse(raw));
      } catch {
        return error(400, "Review the exact memory text and explicitly confirm before saving.");
      }
      const record = getHistoryRecord(input.chatId);
      if (
        !record ||
        record.ownerId !== REVIEWED_MEMORY_OWNER ||
        record.deleted_at !== null ||
        record.revision !== input.expectedRevision
      )
        return error(
          409,
          "The synthetic chat is missing, changed or no longer owned. Nothing was saved.",
        );
      let source;
      try {
        source = reviewedMemorySource(record.payload, REVIEWED_MEMORY_OWNER);
      } catch (cause) {
        return error(409, cause.message);
      }
      if (input.chatId !== REVIEWED_MEMORY_CHAT_ID || source.conversation.id !== input.chatId)
        return error(
          409,
          "Only the explicit four-message synthetic sample can save reviewed text.",
        );
      if (scenario === "chat-reviewed-memory-rejected")
        return error(400, "Synthetic reviewed-memory save rejected. No local memory was created.");
      if (scenario === "chat-reviewed-memory-uncertain")
        return error(
          503,
          "Could not confirm reviewed-memory save. This synthetic uncertain outcome makes no local commit; check Memory Center or reset.",
        );
      saved = {
        chat_id: input.chatId,
        title: source.title,
        summary: input.text,
        updated_at: REVIEWED_MEMORY_TIME,
      };
      return reply(200, { ok: true, saved: true, chatId: input.chatId });
    },
  };
}
