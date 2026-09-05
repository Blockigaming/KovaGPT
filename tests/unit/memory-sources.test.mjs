import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemorySourceUpdater,
  createMemorySourceReceiver,
  memorySourcesDelta,
  normalizeMemorySources,
  normalizeMemorySourceRefs,
  MAX_MEMORY_SOURCES,
} from "../../src/lib/memory-sources.mjs";
import { createMemorySourceInspection } from "../../src/lib/memory-source-inspection.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const source = { kind: "chat_memory", id: "33333333-3333-4333-8333-333333333333" };

test("memory attribution persists bounded real identifiers, never private snapshots or arbitrary fields", () => {
  const metadata = normalizeMemorySources(
    {
      ownerId: owner,
      title: "secret",
      sources: [
        { ...source, title: "secret", content: "private", summary: "secret" },
        source,
        { kind: "chat_memory", id: "chat-memory-1" },
        { kind: "project_memory", id: other },
        { kind: "conversation_summary", id: other },
      ],
    },
    owner,
  );
  assert.deepEqual(metadata, {
    ownerId: owner,
    sources: [source, { kind: "conversation_summary", id: other }],
  });
  assert.equal(JSON.stringify(metadata).includes("secret"), false);
  assert.equal(
    normalizeMemorySourceRefs(
      Array.from({ length: MAX_MEMORY_SOURCES + 10 }, (_, index) => ({
        ...source,
        id: `${index.toString().padStart(8, "0")}-1111-4111-8111-111111111111`,
      })),
    ).length,
    MAX_MEMORY_SOURCES,
  );
});

test("Temporary, guests, mismatched accounts and upstream replacement events cannot expose attribution", () => {
  for (const ownerId of [null, other])
    assert.equal(normalizeMemorySources({ ownerId: owner, sources: [source] }, ownerId), undefined);
  assert.deepEqual(memorySourcesDelta(owner, [source], true), {
    kind: "memory_sources",
    owner_id: null,
    sources: [],
  });
  const receive = createMemorySourceReceiver(owner);
  assert.equal(receive(memorySourcesDelta(null, [])), undefined);
  assert.equal(receive(memorySourcesDelta(owner, [source])), undefined);
  assert.equal(
    createMemorySourceReceiver(owner, true)(memorySourcesDelta(owner, [source])),
    undefined,
  );
});

test("late source bodies are discarded after close, account replacement, or a newer inspection", async () => {
  const waiting = [];
  const loader = createMemorySourceInspection(
    (input) => new Promise((resolve) => waiting.push({ input, resolve })),
  );
  const a = loader.load({ ownerId: owner, sources: [source] });
  loader.invalidate();
  waiting.shift().resolve([{ ...source, available: true, content: "private old account" }]);
  assert.equal(await a, null);
  const first = loader.load({ ownerId: owner, sources: [source] });
  const second = loader.load({ ownerId: other, sources: [source] });
  const one = waiting.shift(),
    two = waiting.shift();
  two.resolve([{ ...source, available: false }]);
  assert.deepEqual((await second).entries, [{ ...source, available: false }]);
  one.resolve([{ ...source, available: true, content: "stale body" }]);
  assert.equal(await first, null);
});

test("the actual response updater fences both event reception and deferred React publication", () => {
  let current = true;
  let pending;
  const conversations = [
    { id: "chat", messages: [{ id: "response", role: "assistant", content: "Answer" }] },
  ];
  const update = createMemorySourceUpdater(
    owner,
    false,
    "chat",
    "response",
    () => current,
    (next) => {
      pending = next;
    },
  );
  update(memorySourcesDelta(owner, [source]));
  current = false;
  assert.equal(pending(conversations), conversations);
  pending = undefined;
  update(memorySourcesDelta(owner, [source]));
  assert.equal(pending, undefined);
  current = true;
  const fresh = createMemorySourceUpdater(
    owner,
    false,
    "chat",
    "response",
    () => current,
    (next) => {
      pending = next;
    },
  );
  fresh(memorySourcesDelta(owner, [source]));
  assert.deepEqual(pending(conversations)[0].messages[0].memorySources, {
    ownerId: owner,
    sources: [source],
  });
});
