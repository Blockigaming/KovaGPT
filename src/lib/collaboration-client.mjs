export class CollaborationError extends Error {
  constructor(code) {
    super(
      code === "40001"
        ? "This draft changed elsewhere. Your edits are preserved."
        : code === "42501"
          ? "Collaboration access is unavailable."
          : "Collaboration could not be reached. Your edits are preserved.",
    );
    this.code = code;
  }
}
export function createCollaborationClient({ config, getSession, fetchImpl = fetch }) {
  return async (actorId, operation, data, signal) => {
    const timeout = AbortSignal.timeout(10000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const {
      data: { session },
    } = await getSession();
    if (combined.aborted || session?.user.id !== actorId || !session.access_token)
      throw new CollaborationError("42501");
    // Capture the verified principal's token before dispatch; subsequent sign-in
    // changes cannot redirect an old draft into the next account.
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/collaboration_rpc`, {
      method: "POST",
      signal: combined,
      headers: {
        "Content-Type": "application/json",
        apikey: config.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ p_operation: operation, p_data: data }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new CollaborationError("unavailable");
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) throw new CollaborationError("too_large");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let result;
    try {
      result = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new CollaborationError("unavailable");
    }
    if (!response.ok) throw new CollaborationError(String(result?.code ?? "unavailable"));
    if (combined.aborted) throw new CollaborationError("cancelled");
    return result;
  };
}

// Supabase Postgres Changes payloads are invalidation hints only. Refetching
// through the pinned JWT rechecks current membership and supplies canonical state.
export function createCollaborationLifecycle({
  refresh,
  heartbeat,
  leave,
  subscribe,
  onStatus,
  onPeers,
  onDenied,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  let active = true,
    pollTimer,
    refreshTimer,
    pending = false,
    again = false;
  let sequence = 0;
  const controller = new AbortController();
  let stopSubscription = () => {};
  const stop = () => {
    if (!active) return;
    active = false;
    controller.abort();
    unschedule(pollTimer);
    unschedule(refreshTimer);
    stopSubscription();
    onPeers(0);
    void leave(++sequence).catch(() => {});
  };
  const update = async (withPresence = false) => {
    if (!active) return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    try {
      if (withPresence) {
        try {
          const presence = await heartbeat(++sequence, controller.signal);
          if (!active) return;
          onPeers(presence.peers);
        } catch (error) {
          if (!active) return;
          if (error?.code === "42501") throw error;
          // Reaching the bounded presence-session cap must not prevent fresh
          // authorized content reads or revision-conflict discovery.
          onPeers(0);
          onStatus("reconnecting");
        }
      }
      await refresh(controller.signal);
    } catch (error) {
      if (!active) return;
      onStatus("reconnecting");
      onPeers(0);
      if (error?.code === "42501") {
        stop();
        onDenied();
      }
    } finally {
      pending = false;
      if (active && again) {
        again = false;
        unschedule(refreshTimer);
        refreshTimer = schedule(() => {
          void update();
        }, 500);
      }
    }
  };
  const poll = () => {
    if (!active) return;
    void update(true);
    pollTimer = schedule(poll, 15000);
  };
  const invalidate = () => {
    if (!active) return;
    unschedule(refreshTimer);
    refreshTimer = schedule(() => {
      void update();
    }, 500);
  };
  stopSubscription = subscribe(invalidate, (state) => {
    if (!active) return;
    onStatus(state === "SUBSCRIBED" ? "connected" : "reconnecting");
    if (state === "SUBSCRIBED") invalidate();
  });
  if (!active) stopSubscription();
  poll();
  return stop;
}

export function resolveCommentAnchor(content, anchor) {
  if (!anchor) return { state: "document" };
  const points = Array.from(content);
  const contextual = `${anchor.prefix}${anchor.quote}${anchor.suffix}`;
  const candidates = [];
  for (
    let index = content.indexOf(contextual);
    index >= 0;
    index = content.indexOf(contextual, index + 1)
  ) {
    candidates.push(index + anchor.prefix.length);
    if (candidates.length > 1) return { state: "removed" };
  }
  if (candidates.length !== 1) return { state: "removed" };
  const start = Array.from(content.slice(0, candidates[0])).length;
  const end = start + Array.from(anchor.quote).length;
  if (points.slice(start, end).join("") !== anchor.quote) return { state: "removed" };
  return {
    state: start === anchor.start ? "attached" : "moved",
    start: candidates[0],
    end: candidates[0] + anchor.quote.length,
  };
}

// Keep explicitly loaded older pages across refreshes, removing server-deleted
// comments even when their tombstones are outside the latest page.
export function mergeCanvasComments(previous, incoming, deletedIds) {
  const deleted = new Set(deletedIds);
  const fresh = new Map(incoming.map((comment) => [comment.id, comment]));
  for (const comment of previous) if (!fresh.has(comment.id)) fresh.set(comment.id, comment);
  return [...fresh.values()]
    .filter((comment) => !deleted.has(comment.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 500);
}

/** Compaction retires deleted IDs, so earlier pages and mutation retries must
 * not cross that boundary. Within an epoch, retain observed deletion notices. */
export function mergeCanvasSnapshot(previous, incoming) {
  if (!previous) return incoming;
  const before = previous.document.comment_epoch ?? 0;
  const after = incoming.document.comment_epoch ?? 0;
  if (before > after || previous.document.revision > incoming.document.revision) return previous;
  if (before !== after) return incoming;
  const deletedCommentIds = [
    ...new Set([...previous.deletedCommentIds, ...incoming.deletedCommentIds]),
  ];
  return {
    ...incoming,
    deletedCommentIds,
    comments: mergeCanvasComments(previous.comments, incoming.comments, deletedCommentIds),
  };
}
