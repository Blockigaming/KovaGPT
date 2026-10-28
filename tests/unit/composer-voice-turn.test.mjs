import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import { deferred, loadUiModule } from "../helpers/ui-state-harness.mjs";

const { awaitSavedComposerVoiceTurn } = loadUiModule(
  "src/lib/composer-voice-turn.ts",
  {},
  {
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
  },
);

const turn = Object.freeze({
  ownerId: "owner-a",
  chatId: "chat-a",
  messageId: "reply-a",
  content: "The exact completed reply.\nWith its original whitespace.",
  voiceModelReceipt: `${"a".repeat(64)}.${"b".repeat(43)}`,
});

function fixture() {
  const controller = new AbortController();
  const conversation = {
    id: turn.chatId,
    title: "Current chat",
    messages: [
      {
        id: turn.messageId,
        role: "assistant",
        content: turn.content,
        voiceModelReceipt: turn.voiceModelReceipt,
      },
    ],
  };
  const state = {
    ownerId: turn.ownerId,
    complete: true,
    records: {
      [turn.chatId]: {
        id: turn.chatId,
        archived: false,
        dirty: false,
        migration: false,
        conflict: null,
        request: null,
        serverHash: "a".repeat(64),
        localHash: "a".repeat(64),
        local: structuredClone(conversation),
      },
    },
  };
  let current = true,
    items = [conversation],
    history = state,
    notification = null,
    unsubscribed = 0,
    saved = [],
    reads = 0;
  return {
    controller,
    conversation,
    state,
    get row() {
      return state.records[turn.chatId];
    },
    get saved() {
      return saved;
    },
    get reads() {
      return reads;
    },
    get unsubscribed() {
      return unsubscribed;
    },
    current(value) {
      current = value;
    },
    items(value) {
      items = value;
    },
    history(value) {
      history = value;
    },
    notify() {
      notification?.();
    },
    options: {
      turn,
      signal: controller.signal,
      isCurrent: () => current,
      getConversations: () => items,
      saveConversations: async (next) => {
        saved.push(next);
        return true;
      },
      loadHistoryState: async () => {
        reads++;
        return history;
      },
      subscribeHistory: (notify) => {
        notification = notify;
        return () => {
          unsubscribed++;
          notification = null;
        };
      },
      timeoutMs: 100,
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const abortError = (error) => error.name === "AbortError";

test("speech receipt uses the exact completed identity only after save and server acknowledgement", async () => {
  const f = fixture();
  f.items([
    f.conversation,
    { id: "another", messages: [] },
    { id: "temporary", temporary: true, messages: [] },
  ]);
  const receipt = await awaitSavedComposerVoiceTurn(f.options);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
    ...turn,
    contentSha256: createHash("sha256").update(turn.content).digest("hex"),
  });
  assert.deepEqual(
    f.saved[0].map((value) => value.id),
    [turn.chatId, "another"],
  );
  assert.equal(f.unsubscribed, 1);
});

test("a voice turn without a server model receipt never writes or authorizes playback", async () => {
  const f = fixture();
  const { voiceModelReceipt: _receipt, ...unproven } = turn;
  await assert.rejects(
    awaitSavedComposerVoiceTurn({ ...f.options, turn: unproven }),
    /voice_reply_unavailable/,
  );
  assert.equal(f.saved.length, 0);
});

test("React's final-token state must actually commit before history is saved", async () => {
  const f = fixture();
  f.items([]);
  const pending = awaitSavedComposerVoiceTurn(f.options);
  await tick();
  assert.equal(f.saved.length, 0);
  f.items([f.conversation]);
  f.notify();
  await pending;
  assert.equal(f.saved.length, 1);
});

test("a device save does not authorize speech until the same exact row is server acknowledged", async () => {
  const f = fixture();
  f.row.dirty = true;
  f.row.serverHash = null;
  let finished = false;
  const pending = awaitSavedComposerVoiceTurn(f.options).then((value) => {
    finished = true;
    return value;
  });
  await tick();
  assert.equal(f.saved.length, 1);
  assert.equal(finished, false);
  f.row.dirty = false;
  f.row.serverHash = f.row.localHash;
  f.notify();
  await pending;
  assert.equal(finished, true);
});

for (const [name, update] of [
  [
    "another owner",
    (f) => {
      f.state.ownerId = "owner-b";
    },
  ],
  [
    "incomplete history",
    (f) => {
      f.state.complete = false;
    },
  ],
  [
    "cleared history",
    (f) => {
      f.state.cleared = true;
    },
  ],
  [
    "unsent migration",
    (f) => {
      f.row.migration = true;
    },
  ],
  [
    "conflicting history",
    (f) => {
      f.row.conflict = { remote: null };
    },
  ],
  [
    "failed history write",
    (f) => {
      f.row.failure = "denied";
    },
  ],
  [
    "pending history request",
    (f) => {
      f.row.request = { mutationId: "pending" };
    },
  ],
  [
    "another message content",
    (f) => {
      f.row.local.messages[0].content = "Changed text";
    },
  ],
  [
    "a failed reply",
    (f) => {
      f.row.local.messages[0].generationStatus = "failed";
    },
  ],
  [
    "a pending image",
    (f) => {
      f.row.local.messages[0].pendingImage = true;
    },
  ],
  [
    "a local-only save",
    (f) => {
      f.row.serverHash = null;
    },
  ],
  [
    "an unmatched hash",
    (f) => {
      f.row.serverHash = "b".repeat(64);
    },
  ],
  [
    "an archived row",
    (f) => {
      f.row.archived = true;
    },
  ],
]) {
  test(`${name} cannot become a spoken-response receipt`, async () => {
    const f = fixture();
    update(f);
    await assert.rejects(
      awaitSavedComposerVoiceTurn({ ...f.options, timeoutMs: 5 }),
      /voice_history_not_synced/,
    );
    assert.equal(f.unsubscribed, 1);
  });
}

for (const [name, update] of [
  [
    "temporary",
    (f) => {
      f.conversation.temporary = true;
    },
  ],
  [
    "stopped",
    (f) => {
      f.conversation.messages[0].generationStatus = "stopped";
    },
  ],
  [
    "duplicate message IDs",
    (f) => {
      f.conversation.messages.push({ ...f.conversation.messages[0] });
    },
  ],
  [
    "duplicate chat IDs",
    (f) => {
      f.items([f.conversation, { ...f.conversation }]);
    },
  ],
]) {
  test(`${name} React snapshots cannot be persisted as a voice reply`, async () => {
    const f = fixture();
    update(f);
    await assert.rejects(
      awaitSavedComposerVoiceTurn({ ...f.options, timeoutMs: 5 }),
      /voice_history_not_synced/,
    );
    assert.equal(f.saved.length, 0);
  });
}

test("failed local save stops before acknowledgement reads", async () => {
  const f = fixture();
  await assert.rejects(
    awaitSavedComposerVoiceTurn({ ...f.options, saveConversations: () => false }),
    /voice_history_not_saved/,
  );
  assert.equal(f.reads, 0);
  assert.equal(f.unsubscribed, 1);
});

test("a throwing history writer is reported as a stable save failure", async () => {
  const f = fixture();
  await assert.rejects(
    awaitSavedComposerVoiceTurn({
      ...f.options,
      saveConversations: async () => {
        throw Error("internal writer details");
      },
    }),
    (error) => error.message === "voice_history_not_saved",
  );
  assert.equal(f.reads, 0);
  assert.equal(f.unsubscribed, 1);
});

test("Stop cancels a stalled save immediately and a late save cannot resume playback", async () => {
  const f = fixture();
  const gate = deferred();
  const pending = awaitSavedComposerVoiceTurn({
    ...f.options,
    saveConversations: () => gate.promise,
  });
  f.controller.abort();
  await assert.rejects(pending, abortError);
  gate.resolve(true);
  await tick();
  assert.equal(f.reads, 0);
  assert.equal(f.unsubscribed, 1);
});

test("close or account/chat change rejects a late acknowledgement", async () => {
  const f = fixture();
  const gate = deferred();
  const pending = awaitSavedComposerVoiceTurn({
    ...f.options,
    loadHistoryState: () => gate.promise,
  });
  await tick();
  f.current(false);
  gate.resolve(f.state);
  await assert.rejects(pending, abortError);
  assert.equal(f.unsubscribed, 1);
});

test("an edited response cannot reuse the completed turn's receipt", async () => {
  const f = fixture();
  const pending = awaitSavedComposerVoiceTurn({
    ...f.options,
    loadHistoryState: async () => {
      f.conversation.messages[0].content = "Edited while syncing";
      return f.state;
    },
  });
  await assert.rejects(pending, /voice_reply_changed/);
});

test("unavailable history is a bounded stable failure", async () => {
  const f = fixture();
  await assert.rejects(
    awaitSavedComposerVoiceTurn({
      ...f.options,
      loadHistoryState: async () => {
        throw Error("internal detail");
      },
    }),
    /voice_history_unavailable/,
  );
  assert.equal(f.unsubscribed, 1);
});

test("Stop also cancels a stalled acknowledgement read", async () => {
  const f = fixture();
  const pending = awaitSavedComposerVoiceTurn({
    ...f.options,
    loadHistoryState: () => new Promise(() => {}),
  });
  await tick();
  f.controller.abort();
  await assert.rejects(pending, abortError);
  assert.equal(f.unsubscribed, 1);
});

test("the total deadline bounds a stalled history operation", async () => {
  const f = fixture();
  await assert.rejects(
    awaitSavedComposerVoiceTurn({
      ...f.options,
      timeoutMs: 5,
      loadHistoryState: () => new Promise(() => {}),
    }),
    /voice_history_not_synced/,
  );
  assert.equal(f.unsubscribed, 1);
});

test("an already stale or cancelled turn performs no persistence", async () => {
  const f = fixture();
  f.current(false);
  await assert.rejects(awaitSavedComposerVoiceTurn(f.options), abortError);
  f.current(true);
  f.controller.abort();
  await assert.rejects(awaitSavedComposerVoiceTurn(f.options), abortError);
  assert.equal(f.saved.length, 0);
});
