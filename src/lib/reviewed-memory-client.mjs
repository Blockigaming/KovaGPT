import { loadChatHistoryDevice } from "./chat-history-idb.mjs";
import { fetchForPrincipal } from "./chat-summary-snapshot.mjs";
import { enqueueMemoryWrite } from "./memory-write-coordinator.mjs";
import {
  parseReviewedMemoryRequest,
  syncedReviewedMemorySource,
} from "./reviewed-memory-policy.mjs";

export async function loadReviewedMemorySource(ownerId, conversation, dependencies = {}) {
  return syncedReviewedMemorySource(
    await (dependencies.loadDevice ?? loadChatHistoryDevice)(ownerId),
    conversation,
    ownerId,
  );
}

/** Only the final explicit Save calls this function. Review/Cancel do not write. */
export async function saveReviewedMemory(input, dependencies = {}) {
  const current = () => {
    input.signal?.throwIfAborted();
    if (!input.isCurrent())
      throw new Error("This memory review is no longer current. Reopen it from the chat.");
  };
  current();
  const body = parseReviewedMemoryRequest({
    operation: "save_reviewed_memory",
    chatId: input.conversation.id,
    expectedRevision: input.revision,
    memoryEnabled: true,
    temporary: false,
    confirmed: true,
    text: input.text,
  });
  const result = await (dependencies.enqueue ?? enqueueMemoryWrite)({
    principal: input.ownerId,
    run: async () => {
      current();
      const source = await loadReviewedMemorySource(
        input.ownerId,
        input.conversation,
        dependencies,
      );
      current();
      if (source.revision !== input.revision)
        throw new Error(
          "This chat changed. Close this review and try again from the current chat.",
        );
      let response;
      try {
        response = await (dependencies.request ?? fetchForPrincipal)(input.ownerId, "/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        });
      } catch {
        current();
        throw new Error(
          "Could not confirm that memory was saved. Review Memory Center before trying again.",
        );
      }
      const value = await response.json().catch(() => null);
      current();
      if (
        !response.ok ||
        value?.ok !== true ||
        value?.saved !== true ||
        value?.chatId !== body.chatId
      )
        throw new Error(
          typeof value?.error === "string"
            ? value.error.slice(0, 300)
            : "Could not confirm that memory was saved. Review Memory Center before trying again.",
        );
    },
  });
  current();
  if (result !== "written")
    throw new Error("Memory saving is turned off or your account changed. Nothing was submitted.");
}
