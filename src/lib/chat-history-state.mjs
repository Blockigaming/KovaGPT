import {
  canonicalChatHistory,
  chatHistoryUuid,
  chatHistoryId,
  normalizeChatHistory,
} from "./chat-history-policy.mjs";

export async function chatHistoryHash(payload, archived = false) {
  const value = canonicalChatHistory({ payload, archived: payload ? archived : false });
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function createChatHistoryState(ownerId, localEpoch = crypto.randomUUID()) {
  return {
    version: 1,
    ownerId: chatHistoryUuid(ownerId),
    localEpoch,
    epoch: null,
    cursor: 0,
    complete: false,
    records: {},
  };
}
const recordSizes = new WeakMap();
function checkCapacity(records) {
  const rows = Object.values(records);
  if (rows.length > 10000 || rows.filter((r) => r.local).length > 1000)
    throw new Error("chat_history_capacity");
  let bytes = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("chat_history_device_unavailable");
    let size = recordSizes.get(row);
    if (size === undefined) {
      size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
      recordSizes.set(row, size);
    }
    bytes += size;
    if (bytes > 150 * 1024 * 1024) throw new Error("chat_history_device_capacity");
  }
}
/** Validate durable cache content before it can render or become an upload. */
export async function restoreChatHistoryState(stored, ownerId) {
  if (
    !stored ||
    stored.ownerId !== ownerId ||
    stored.version !== 1 ||
    !Number.isSafeInteger(stored.cursor) ||
    stored.cursor < 0 ||
    !stored.records ||
    Array.isArray(stored.records)
  )
    throw new Error("chat_history_device_unavailable");
  chatHistoryUuid(stored.localEpoch);
  if (stored.epoch !== null) chatHistoryUuid(stored.epoch);
  checkCapacity(stored.records);
  const records = {};
  for (const [id, row] of Object.entries(stored.records)) {
    chatHistoryId(id);
    if (
      row.id !== id ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 0 ||
      typeof row.archived !== "boolean" ||
      typeof row.dirty !== "boolean" ||
      typeof row.migration !== "boolean" ||
      (row.serverHash !== null && !/^[a-f0-9]{64}$/u.test(row.serverHash))
    )
      throw new Error("chat_history_device_unavailable");
    const local = row.local === null ? null : normalizeChatHistory(row.local, ownerId);
    if (local && local.id !== id) throw new Error("chat_history_device_unavailable");
    const localHash = await chatHistoryHash(local, row.archived);
    if (localHash !== row.localHash) throw new Error("chat_history_device_unavailable");
    let request = null,
      conflict = null;
    if (row.request) {
      request = { ...row.request };
      chatHistoryUuid(request.mutationId);
      chatHistoryUuid(request.epoch);
      if (
        request.id !== id ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 ||
        typeof request.archived !== "boolean"
      )
        throw new Error("chat_history_device_unavailable");
      request.payload =
        request.payload === null ? null : normalizeChatHistory(request.payload, ownerId);
      if (
        (request.payload && request.payload.id !== id) ||
        request.hash !== (await chatHistoryHash(request.payload, request.archived))
      )
        throw new Error("chat_history_device_unavailable");
    }
    if (row.conflict) {
      conflict = {
        ...row.conflict,
        remote:
          row.conflict.remote === null ? null : normalizeChatHistory(row.conflict.remote, ownerId),
      };
      if (
        (conflict.remote && conflict.remote.id !== id) ||
        typeof conflict.archived !== "boolean" ||
        typeof conflict.epochChanged !== "boolean"
      )
        throw new Error("chat_history_device_unavailable");
    }
    records[id] = { ...row, local, request, conflict };
  }
  return { ...stored, complete: false, records };
}
export function visibleChatHistory(state, archived = false) {
  return Object.values(state.records)
    .filter((r) => r.local && r.archived === archived)
    .map((r) => r.local)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function seedChatHistory(state, conversations, archivedConversations) {
  const records = { ...state.records };
  for (const [archived, items] of [
    [false, conversations],
    [true, archivedConversations],
  ]) {
    for (const item of items.filter((v) => !v.temporary)) {
      const payload = normalizeChatHistory(item, state.ownerId);
      if (records[payload.id]) continue;
      records[payload.id] = {
        id: payload.id,
        revision: 0,
        serverHash: null,
        local: payload,
        archived,
        localHash: await chatHistoryHash(payload, archived),
        migration: true,
        dirty: false,
        request: null,
        conflict: null,
      };
    }
  }
  checkCapacity(records);
  return { ...state, records };
}
export async function updateChatHistoryList(
  state,
  conversations,
  archived,
  sameInput = () => false,
  automatic = false,
) {
  const next = { ...state, records: { ...state.records } };
  const seen = new Set();
  for (const item of conversations.filter((v) => !v.temporary)) {
    const id = chatHistoryId(item.id);
    if (seen.has(id)) throw new Error("chat_history_invalid");
    seen.add(id);
    const previous = next.records[id];
    // A debounced active snapshot cannot undo an explicit archive or deletion
    // that completed while its device I/O was waiting in the owner queue.
    if (automatic && previous && (!previous.local || previous.archived !== archived)) continue;
    if (previous?.local && previous.archived === archived && sameInput(item, previous)) continue;
    const payload = normalizeChatHistory(item, state.ownerId);
    const hash = await chatHistoryHash(payload, archived);
    if (previous?.localHash === hash) continue;
    next.records[id] = {
      ...(previous ?? {
        id,
        revision: 0,
        serverHash: null,
        request: null,
        conflict: null,
        migration: false,
      }),
      local: payload,
      archived,
      localHash: hash,
      dirty: true,
      failure: null,
    };
  }
  for (const [id, previous] of Object.entries(next.records)) {
    if (!previous.local || previous.archived !== archived || seen.has(id)) continue;
    next.records[id] = {
      ...previous,
      local: null,
      archived: false,
      localHash: await chatHistoryHash(null),
      dirty: true,
      failure: null,
    };
    if (previous.migration && !previous.revision) delete next.records[id];
  }
  checkCapacity(next.records);
  return next;
}
export function allowChatHistoryMigration(state) {
  const records = Object.fromEntries(
    Object.entries(state.records).map(([id, r]) => [
      id,
      r.migration ? { ...r, migration: false, dirty: true } : r,
    ]),
  );
  return { ...state, records };
}
export function nextChatHistoryRequest(state) {
  if (!state.epoch || !state.complete) return null;
  const record = Object.values(state.records).find(
    (r) => r.dirty && !r.migration && !r.conflict && !r.failure,
  );
  if (!record) return null;
  return (
    record.request ?? {
      mutationId: crypto.randomUUID(),
      epoch: state.epoch,
      id: record.id,
      expectedRevision: record.revision,
      payload: record.local,
      archived: record.archived,
      hash: record.localHash,
    }
  );
}
export function captureChatHistoryRequest(state, request) {
  const r = state.records[request.id];
  if (!r || r.conflict || r.migration) throw new Error("chat_history_invalid");
  return { ...state, records: { ...state.records, [r.id]: { ...r, request } } };
}
export function acknowledgeChatHistory(state, request, result) {
  const r = state.records[request.id];
  if (!r || r.request?.mutationId !== request.mutationId) return state;
  if (
    result.id !== request.id ||
    result.mutationId !== request.mutationId ||
    result.revision !== request.expectedRevision + 1 ||
    !Number.isSafeInteger(result.syncVersion)
  )
    throw new Error("chat_history_invalid_response");
  return {
    ...state,
    records: {
      ...state.records,
      [r.id]: {
        ...r,
        revision: result.revision,
        serverHash: request.hash,
        dirty: r.localHash !== request.hash,
        request: null,
        conflict: null,
      },
    },
  };
}

/** Apply one bounded cloud page without replacing unacknowledged local content. */
export async function applyChatHistoryPage(state, page) {
  if (
    !page ||
    page.ownerId !== state.ownerId ||
    !Array.isArray(page.records) ||
    page.records.length > 1 ||
    typeof page.hasMore !== "boolean" ||
    !Number.isSafeInteger(page.nextCursor) ||
    !Number.isSafeInteger(page.currentVersion) ||
    page.currentVersion < page.nextCursor
  )
    throw new Error("chat_history_invalid_response");
  chatHistoryUuid(page.epoch);
  const changedEpoch = state.epoch !== null && state.epoch !== page.epoch;
  let next = {
    ...state,
    epoch: page.epoch,
    cursor: state.epoch !== page.epoch ? 0 : state.cursor,
    records: { ...state.records },
    complete: !page.hasMore,
  };
  if (state.epoch !== page.epoch) {
    // After the bounded deletion journal expires, every unacknowledged local
    // draft requires an explicit choice. It never silently recreates an old ID.
    next.records = Object.fromEntries(
      Object.entries(next.records).map(([id, r]) => [
        id,
        {
          ...r,
          seenInEpoch: false,
          ...(changedEpoch && (r.dirty || r.request)
            ? {
                conflict: { deleted: true, epochChanged: true, remote: null, archived: false },
                request: null,
              }
            : {}),
        },
      ]),
    );
  }
  let cursor = next.cursor;
  for (const row of page.records) {
    const id = chatHistoryId(row.id);
    if (
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !Number.isSafeInteger(row.sync_version) ||
      row.sync_version <= cursor ||
      row.sync_version > page.currentVersion ||
      typeof row.archived !== "boolean"
    )
      throw new Error("chat_history_invalid_response");
    chatHistoryUuid(row.mutation_id);
    const payload =
      row.deleted_at === null ? normalizeChatHistory(row.payload, state.ownerId) : null;
    if (payload && payload.id !== id) throw new Error("chat_history_invalid_response");
    if (
      !payload &&
      (row.payload !== null ||
        typeof row.deleted_at !== "string" ||
        !Number.isFinite(Date.parse(row.deleted_at)))
    )
      throw new Error("chat_history_invalid_response");
    const hash = await chatHistoryHash(payload, row.archived);
    const r = next.records[id];
    if (r?.request?.mutationId === row.mutation_id) {
      next = acknowledgeChatHistory(next, r.request, {
        id,
        mutationId: row.mutation_id,
        revision: row.revision,
        syncVersion: row.sync_version,
      });
      next.records[id] = { ...next.records[id], seenInEpoch: true };
    } else if (
      r &&
      (r.dirty || r.migration || r.conflict) &&
      r.localHash !== hash &&
      (row.revision !== r.revision || changedEpoch)
    ) {
      next.records[id] = {
        ...r,
        revision: row.revision,
        serverHash: hash,
        seenInEpoch: true,
        conflict: {
          remote: payload,
          archived: row.archived,
          epochChanged: Boolean(r.conflict?.epochChanged),
          deleted: !payload,
        },
      };
    } else if (!r || !(r.dirty || r.migration || r.conflict) || r.localHash === hash) {
      next.records[id] = {
        id,
        revision: row.revision,
        serverHash: hash,
        local: payload,
        archived: payload ? row.archived : false,
        localHash: hash,
        dirty: false,
        request: null,
        conflict: null,
        migration: false,
        seenInEpoch: true,
      };
    } else next.records[id] = { ...r, seenInEpoch: true };
    cursor = row.sync_version;
  }
  if (page.nextCursor !== cursor) throw new Error("chat_history_invalid_response");
  next.cursor = cursor;
  if (!page.hasMore) {
    for (const [id, r] of Object.entries(next.records)) {
      if (r.seenInEpoch === false && !r.dirty && !r.migration && !r.conflict)
        delete next.records[id];
    }
  }
  return next;
}
export async function resolveChatHistoryConflict(state, id, choice) {
  const r = state.records[id];
  if (!r?.conflict || !["cloud", "keep"].includes(choice)) throw new Error("chat_history_invalid");
  const records = { ...state.records };
  if (choice === "cloud") {
    records[id] = {
      ...r,
      local: r.conflict.remote,
      archived: r.conflict.archived,
      localHash: await chatHistoryHash(r.conflict.remote, r.conflict.archived),
      dirty: false,
      migration: false,
      conflict: null,
      request: null,
    };
  } else if (r.conflict.epochChanged && r.local) {
    // A tombstone may have expired. Explicit recovery saves a new conversation
    // rather than reusing the identity of potentially deleted account content.
    const copy = {
      ...r.local,
      id: crypto.randomUUID(),
      title: `${r.local.title.slice(0, 480)} (recovered)`,
    };
    records[id] = {
      ...r,
      local: r.conflict.remote,
      archived: r.conflict.archived,
      localHash: await chatHistoryHash(r.conflict.remote, r.conflict.archived),
      dirty: false,
      conflict: null,
      request: null,
      migration: false,
    };
    records[copy.id] = {
      id: copy.id,
      revision: 0,
      serverHash: null,
      local: copy,
      archived: r.archived,
      localHash: await chatHistoryHash(copy, r.archived),
      dirty: true,
      migration: false,
      request: null,
      conflict: null,
    };
  } else records[id] = { ...r, dirty: true, migration: false, request: null, conflict: null };
  return { ...state, records };
}
