/** References only: never persist a private memory title or body in a response. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MEMORY_SOURCES = 221;
export const MEMORY_SOURCES_CHANGED_EVENT = "kova-memory-sources-changed";
export function normalizeMemorySourceRefs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const candidate of value.slice(0, MAX_MEMORY_SOURCES)) {
    if (!candidate || !UUID.test(candidate.id ?? "")) continue;
    const { kind, id } = candidate;
    if (!["chat_memory", "project_memory", "conversation_summary"].includes(kind)) continue;
    if (kind === "project_memory" && !UUID.test(candidate.projectId ?? "")) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      kind,
      id,
      ...(kind === "project_memory" ? { projectId: candidate.projectId } : {}),
    });
  }
  return result;
}
export function normalizeMemorySources(value, ownerId, temporary = false) {
  if (temporary || !UUID.test(ownerId ?? "") || !value || value.ownerId !== ownerId)
    return undefined;
  const sources = normalizeMemorySourceRefs(value.sources);
  return sources.length ? { ownerId, sources } : undefined;
}
export function memorySourcesDelta(ownerId, sources, temporary = false) {
  const value = normalizeMemorySources({ ownerId, sources }, ownerId, temporary);
  return {
    kind: "memory_sources",
    owner_id: value?.ownerId ?? null,
    sources: value?.sources ?? [],
  };
}
/** The first server prefix is authoritative; later upstream events cannot replace it. */
export function createMemorySourceReceiver(ownerId, temporary = false) {
  let received = false;
  return (delta) => {
    if (received || delta?.kind !== "memory_sources") return undefined;
    received = true;
    return normalizeMemorySources(
      { ownerId: delta.owner_id, sources: delta.sources },
      ownerId,
      temporary,
    );
  };
}

export function attachMemorySources(conversations, conversationId, messageId, memorySources) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === messageId && message.role === "assistant"
              ? { ...message, memorySources }
              : message,
          ),
        }
      : conversation,
  );
}

export function createMemorySourceUpdater(
  ownerId,
  temporary,
  conversationId,
  messageId,
  isCurrent,
  update,
) {
  const receive = createMemorySourceReceiver(ownerId, temporary);
  return (delta) => {
    if (!isCurrent()) return;
    const sources = receive(delta);
    if (sources)
      update((conversations) =>
        isCurrent()
          ? attachMemorySources(conversations, conversationId, messageId, sources)
          : conversations,
      );
  };
}
