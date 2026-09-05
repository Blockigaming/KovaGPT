import {
  createChatHistoryState,
  restoreChatHistoryState,
  seedChatHistory,
  visibleChatHistory,
  updateChatHistoryList,
  allowChatHistoryMigration,
  nextChatHistoryRequest,
  captureChatHistoryRequest,
  acknowledgeChatHistory,
  applyChatHistoryPage,
  resolveChatHistoryConflict,
} from "./chat-history-state.mjs";

/** Durable I/O is injectable so crash, auth switch and late-response races are executable tests. */
export function createChatHistoryController({
  ownerId,
  loadDevice,
  commitDevice,
  getLegacy,
  transport,
  changed = () => {},
  status = () => {},
  signal,
}) {
  let state = null,
    stopped = false,
    dirtyGeneration = 0,
    dirty = false,
    running = false;
  let operations = Promise.resolve(),
    cloudCommit = null;
  const inputs = new WeakMap();
  const alive = () => !stopped && !signal.aborted;
  const queue = (operation) => {
    const result = operations.then(async () => {
      if (!alive()) throw new Error("chat_history_canceled");
      return operation();
    });
    operations = result.catch(() => {});
    return result;
  };
  const summary = (phase, error = null) => {
    if (!alive()) return;
    const rows = Object.values(state?.records ?? {});
    status({
      ownerId,
      phase,
      error,
      pending: rows.filter((r) => r.dirty).length,
      migration: rows.filter((r) => r.migration).length,
      conflicts: (state?.complete ? rows : [])
        .filter((r) => r.conflict)
        .map((r) => ({
          id: r.id,
          title: r.local?.title ?? r.conflict.remote?.title ?? "Deleted chat",
          local: r.local,
          cloud: r.conflict.remote,
          epochChanged: r.conflict.epochChanged,
        })),
    });
  };
  async function commit(next, source, commitSignal) {
    await commitDevice(state, next, { signal: commitSignal ?? signal });
    if (!alive() || commitSignal?.aborted) throw new Error("chat_history_canceled");
    state = next;
    changed({
      active: visibleChatHistory(state),
      archived: visibleChatHistory(state, true),
      source,
      dirty,
    });
  }
  async function initialize() {
    return queue(async () => {
      summary("connecting");
      const stored = await loadDevice(ownerId);
      if (!alive()) return;
      if (
        stored &&
        (stored.ownerId !== ownerId ||
          stored.version !== 1 ||
          !stored.records ||
          !Number.isSafeInteger(stored.cursor))
      )
        throw new Error("chat_history_device_unavailable");
      if (stored && !stored.cleared) state = await restoreChatHistoryState(stored, ownerId);
      else {
        const legacy = getLegacy();
        state = await seedChatHistory(
          createChatHistoryState(ownerId, stored?.localEpoch),
          legacy.active,
          legacy.archived,
        );
      }
      await commitDevice(null, state, { signal });
      if (!alive()) return;
      changed({
        active: visibleChatHistory(state),
        archived: visibleChatHistory(state, true),
        source: "cloud",
        dirty,
      });
      summary("connecting");
    });
  }
  function markDirty() {
    dirty = true;
    dirtyGeneration++;
    cloudCommit?.abort();
  }
  async function write(items, archived, automatic = false) {
    const generation = dirtyGeneration;
    try {
      await queue(async () => {
        if (!state) throw new Error("chat_history_device_unavailable");
        summary("saving_device");
        const next = await updateChatHistoryList(
          state,
          items,
          archived,
          (item, record) => inputs.get(item) === record.localHash || item === record.local,
          automatic,
        );
        await commit(next, "local");
        for (const item of items)
          if (next.records[item.id]) inputs.set(item, next.records[item.id].localHash);
        if (generation === dirtyGeneration) dirty = false;
        summary("pending");
      });
      return true;
    } catch (error) {
      summary("device_error", error.message);
      return false;
    }
  }
  async function pump() {
    if (!alive() || !state || running || dirty) return;
    running = true;
    try {
      summary("syncing");
      // Bound each turn; the runtime schedules the next turn while more pages remain.
      for (let i = 0; i < 12 && alive() && !dirty; i++) {
        const epoch = state.epoch,
          cursor = state.cursor;
        const page = await transport({ method: "GET", epoch, cursor, signal });
        await queue(async () => {
          if (dirty || state.epoch !== epoch || state.cursor !== cursor) return;
          cloudCommit = new AbortController();
          try {
            await commit(
              await applyChatHistoryPage(state, page),
              "cloud",
              AbortSignal.any([signal, cloudCommit.signal]),
            );
            summary("syncing");
          } finally {
            cloudCommit = null;
          }
        });
        if (dirty || !page.hasMore) break;
      }
      if (!alive() || dirty || !state.complete) return;
      const request = nextChatHistoryRequest(state);
      if (!request) {
        const rows = Object.values(state.records),
          blocked = rows.find((r) => r.failure);
        summary(
          blocked
            ? "blocked"
            : rows.some((r) => r.conflict)
              ? "conflict"
              : rows.some((r) => r.migration)
                ? "local"
                : rows.some((r) => r.dirty)
                  ? "pending"
                  : "saved",
          blocked?.failure ?? null,
        );
        return;
      }
      await queue(() => commit(captureChatHistoryRequest(state, request), "local"));
      if (!alive()) return;
      const { hash: ignored, ...body } = request;
      try {
        const response = await transport({ method: "POST", body, signal });
        await queue(() => commit(acknowledgeChatHistory(state, request, response), "local"));
      } catch (error) {
        await queue(async () => {
          let next = { ...state, complete: false };
          const record = next.records[request.id];
          if (
            [400, 403, 413].includes(error.status) &&
            record?.request?.mutationId === request.mutationId
          )
            next = {
              ...next,
              records: {
                ...next.records,
                [record.id]: { ...record, request: null, failure: error.message },
              },
            };
          await commit(next, "local");
        });
        throw error;
      }
      summary("pending");
    } catch (error) {
      if (alive()) summary(dirty ? "pending" : "offline", error.message);
    } finally {
      running = false;
    }
  }
  return {
    initialize,
    write,
    markDirty,
    pump,
    getState: () => state,
    get dirty() {
      return dirty;
    },
    async migrate() {
      await queue(() => commit(allowChatHistoryMigration(state), "local"));
      summary("pending");
    },
    async resolve(id, choice) {
      await queue(async () => {
        if (dirty || !state?.complete) throw new Error("chat_history_unsaved_changes");
        return commit(await resolveChatHistoryConflict(state, id, choice), "cloud");
      });
      summary("pending");
    },
    async retry() {
      await queue(() =>
        commit(
          {
            ...state,
            complete: false,
            records: Object.fromEntries(
              Object.entries(state.records).map(([id, r]) => [id, { ...r, failure: null }]),
            ),
          },
          "local",
        ),
      );
      return pump();
    },
    stop() {
      stopped = true;
      cloudCommit?.abort();
    },
  };
}
