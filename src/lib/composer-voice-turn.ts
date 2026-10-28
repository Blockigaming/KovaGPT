import type { Conversation } from "./chat-store";

/** Exact completed response authorized for the existing saved-response speech route. */
export type ComposerVoiceTurn = {
  ownerId: string;
  chatId: string;
  messageId: string;
  content: string;
  contentSha256: string;
  voiceModelReceipt: string;
};

export type ComposerVoiceSubmit = (text: string, signal: AbortSignal) => Promise<ComposerVoiceTurn>;

type PendingVoiceTurn = Omit<ComposerVoiceTurn, "contentSha256">;

type SavedVoiceTurnOptions = {
  turn: PendingVoiceTurn;
  signal: AbortSignal;
  isCurrent: () => boolean;
  getConversations: () => readonly Conversation[];
  saveConversations: (items: Conversation[]) => boolean | Promise<boolean>;
  loadHistoryState: () => Promise<unknown>;
  subscribeHistory?: (notify: () => void) => () => void;
  timeoutMs?: number;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function matchesReply(value: unknown, turn: PendingVoiceTurn): boolean {
  const conversation = object(value);
  if (
    !conversation ||
    conversation.id !== turn.chatId ||
    conversation.temporary ||
    !Array.isArray(conversation.messages)
  )
    return false;
  const messages = conversation.messages.filter((value) => object(value)?.id === turn.messageId);
  if (messages.length !== 1) return false;
  const message = object(messages[0]);
  return Boolean(
    message &&
    message.role === "assistant" &&
    message.content === turn.content &&
    message.voiceModelReceipt === turn.voiceModelReceipt &&
    !message.generationStatus &&
    !message.pendingImage,
  );
}

function acknowledgedReply(value: unknown, turn: PendingVoiceTurn): boolean {
  const state = object(value);
  const records = object(state?.records);
  const row = object(records?.[turn.chatId]);
  return Boolean(
    state?.ownerId === turn.ownerId &&
    state.complete === true &&
    !state.cleared &&
    row &&
    row.id === turn.chatId &&
    row.archived === false &&
    !row.dirty &&
    !row.migration &&
    !row.conflict &&
    !row.failure &&
    !row.request &&
    typeof row.serverHash === "string" &&
    /^[a-f0-9]{64}$/.test(row.serverHash) &&
    row.serverHash === row.localHash &&
    matchesReply(row.local, turn),
  );
}

/**
 * Wait for React's exact completed response, save it through the existing history
 * writer, then observe that writer's server acknowledgement in its device state.
 * This helper neither submits a chat nor adds another history/network writer.
 */
export async function awaitSavedComposerVoiceTurn({
  turn,
  signal,
  isCurrent,
  getConversations,
  saveConversations,
  loadHistoryState,
  subscribeHistory,
  timeoutMs = 15_000,
}: SavedVoiceTurnOptions): Promise<ComposerVoiceTurn> {
  if (
    !turn.ownerId ||
    !turn.chatId ||
    !turn.messageId ||
    !turn.content.trim() ||
    !/^[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{43}$/u.test(turn.voiceModelReceipt)
  )
    throw new Error("voice_reply_unavailable");

  const canceled = () => new DOMException("Voice turn cancelled or changed.", "AbortError");
  const check = () => {
    if (signal.aborted || !isCurrent()) throw canceled();
  };
  check();
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  // Cancellation can happen between awaits; keep that shared rejection handled.
  void cancellation.catch(() => undefined);
  const onAbort = () => rejectCancellation(canceled());
  signal.addEventListener("abort", onAbort, { once: true });
  const duration = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 15_000)) : 15_000;
  const deadline = setTimeout(
    () => rejectCancellation(new Error("voice_history_not_synced")),
    duration,
  );
  let unsubscribe: (() => void) | undefined;
  let wake: (() => void) | null = null;
  let notified = false;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  const guarded = async <T>(value: PromiseLike<T> | T): Promise<T> => {
    check();
    const result = await Promise.race([Promise.resolve(value), cancellation]);
    check();
    return result;
  };
  const pause = async (ms: number) => {
    check();
    if (notified) {
      notified = false;
      return;
    }
    try {
      await guarded(
        new Promise<void>((resolve) => {
          wake = resolve;
          pauseTimer = setTimeout(resolve, ms);
        }),
      );
    } finally {
      if (pauseTimer !== null) clearTimeout(pauseTimer);
      pauseTimer = null;
      wake = null;
      notified = false;
    }
  };

  try {
    unsubscribe = subscribeHistory?.(() => {
      notified = true;
      wake?.();
    });
    let conversations: readonly Conversation[];
    // A completed send may resolve before React commits its final token flush.
    // Wait for that actual state rather than rebuilding a lossy message snapshot.
    while (true) {
      check();
      conversations = getConversations();
      const matching = conversations.filter((conversation) => conversation.id === turn.chatId);
      if (matching.length === 1 && matchesReply(matching[0], turn)) break;
      await pause(25);
    }
    check();
    let saved: boolean;
    try {
      saved = await guarded(
        saveConversations(conversations.filter((conversation) => !conversation.temporary)),
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      if ((error as Error).message === "voice_history_not_synced") throw error;
      throw new Error("voice_history_not_saved", { cause: error });
    }
    if (saved !== true) throw new Error("voice_history_not_saved");

    while (true) {
      check();
      let state: unknown;
      try {
        state = await guarded(loadHistoryState());
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        if ((error as Error).message === "voice_history_not_synced") throw error;
        throw new Error("voice_history_unavailable", { cause: error });
      }
      if (acknowledgedReply(state, turn)) {
        const matching = getConversations().filter(
          (conversation) => conversation.id === turn.chatId,
        );
        if (matching.length !== 1 || !matchesReply(matching[0], turn))
          throw new Error("voice_reply_changed");
        break;
      }
      await pause(250);
    }
    check();
    const digest = await guarded(
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(turn.content)),
    );
    check();
    const matching = getConversations().filter((conversation) => conversation.id === turn.chatId);
    if (matching.length !== 1 || !matchesReply(matching[0], turn))
      throw new Error("voice_reply_changed");
    return {
      ...turn,
      contentSha256: Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join(""),
    };
  } finally {
    clearTimeout(deadline);
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    signal.removeEventListener("abort", onAbort);
    unsubscribe?.();
    wake = null;
  }
}
