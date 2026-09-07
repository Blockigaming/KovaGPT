import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { inspectMemorySources } from "../../src/lib/memory-sources.server.mjs";
import { consumeChatSse } from "../../src/lib/chat-sse-client.mjs";
import {
  attachMemorySources,
  createMemorySourceReceiver,
  memorySourcesDelta,
} from "../../src/lib/memory-sources.mjs";
import {
  conversationStorageKey,
  chatRequestMessages,
  loadConversations,
  saveConversations,
  saveArchivedConversations,
  loadArchivedConversations,
} from "../../src/lib/chat-store.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const project = "44444444-4444-4444-8444-444444444444";
const source = { kind: "chat_memory", id };
function database(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const scope = { table, filters: [] };
      calls.push(scope);
      const query = {
        select(columns) {
          scope.columns = columns;
          return query;
        },
        eq(key, value) {
          scope.filters.push([key, value]);
          return query;
        },
        in(key, values) {
          scope.ids = values;
          return query;
        },
        async limit(limit) {
          scope.limit = limit;
          return { data: rows[table] ?? [], error: null };
        },
      };
      return query;
    },
  };
}

test("inspection rechecks current owner rows and project RLS references; deletion never returns the old snapshot", async () => {
  const rows = {
    chat_memories: [{ id, user_id: owner, title: "A", summary: "current body", updated_at: "now" }],
    project_memory: [{ id: other, project_id: project, content: "project body" }],
    chat_context_summaries: [
      {
        id: project,
        user_id: owner,
        completed_summary: "earlier conversation",
        completed_at: "now",
      },
    ],
  };
  const client = database(rows);
  const refs = [
    source,
    { kind: "project_memory", id: other, projectId: project },
    { kind: "conversation_summary", id: project },
  ];
  const first = await inspectMemorySources(client, owner, { ownerId: owner, sources: refs });
  assert.equal(first[0].content, "current body");
  assert.equal(first[1].content, "project body");
  assert.equal(first[2].content, "earlier conversation");
  assert.deepEqual(client.calls[0].filters, [["user_id", owner]]);
  assert.deepEqual(client.calls[2].filters, [["user_id", owner]]);
  assert.ok(client.calls.every((call) => call.ids.length === 1 && call.limit === 20));
  rows.chat_memories = [];
  rows.project_memory = [];
  rows.chat_context_summaries = [];
  assert.deepEqual(
    await inspectMemorySources(client, owner, { ownerId: owner, sources: refs }),
    refs.map((ref) => ({ ...ref, available: false })),
  );
  await assert.rejects(
    () => inspectMemorySources(client, other, { ownerId: owner, sources: refs }),
    /could not be loaded/,
  );
  rows.chat_memories = [{ id, user_id: other, summary: "another account" }];
  rows.project_memory = [{ id: other, project_id: owner, content: "different project" }];
  assert.ok(
    (await inspectMemorySources(client, owner, { ownerId: owner, sources: refs })).every(
      (entry) => !entry.available,
    ),
  );
});

test("real fragmented SSE carries source refs into reloadable account-local messages and strips refs from Temporary and another principal", async () => {
  const stored = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
    get length() {
      return stored.size;
    },
    key: (index) => [...stored.keys()][index] ?? null,
  };
  const response = { id: "response", role: "assistant", content: "" };
  const receive = createMemorySourceReceiver(owner);
  const raw = `data: ${JSON.stringify({ choices: [{ delta: memorySourcesDelta(owner, [source]) }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "Answer" } }] })}\n\ndata: [DONE]\n\n`;
  await consumeChatSse(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < raw.length; offset += 13)
          controller.enqueue(new TextEncoder().encode(raw.slice(offset, offset + 13)));
        controller.close();
      },
    }),
    {
      onEvent(event) {
        const delta = event.choices[0].delta;
        const memorySources = receive(delta);
        if (memorySources) response.memorySources = memorySources;
        if (delta.content) response.content += delta.content;
      },
    },
  );
  const conversation = {
    id: "conversation",
    title: "Title",
    messages: [response],
    mode: "instant",
    createdAt: 1,
    updatedAt: 1,
  };
  assert.deepEqual(
    chatRequestMessages([response], {
      id: "question",
      role: "user",
      content: "Next",
      attachments: [],
    }),
    [
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Next", attachments: [] },
    ],
  );
  const attached = attachMemorySources(
    [
      {
        ...conversation,
        messages: [
          { id: "user", role: "user", content: "Question" },
          { ...response, memorySources: undefined },
        ],
      },
    ],
    conversation.id,
    response.id,
    response.memorySources,
  );
  assert.deepEqual(attached[0].messages[1].memorySources, response.memorySources);
  assert.equal(attached[0].messages[0].memorySources, undefined);
  assert.equal(saveConversations(owner, [conversation]), true);
  assert.deepEqual(loadConversations(owner)[0].messages[0], response);
  saveArchivedConversations(owner, [conversation]);
  assert.deepEqual(loadArchivedConversations(owner)[0].messages[0], response);
  // Attribution sanitation must not impose active-chat retention on existing archives.
  const longArchive = {
    ...conversation,
    messages: Array.from({ length: 1001 }, (_, index) => ({
      ...response,
      id: `archived-${index}`,
    })),
  };
  saveArchivedConversations(owner, [longArchive]);
  assert.equal(loadArchivedConversations(owner)[0].messages.length, 1001);
  assert.equal(loadArchivedConversations(owner)[0].messages[0].id, "archived-0");
  saveConversations(other, [conversation]);
  assert.equal(loadConversations(other)[0].messages[0].memorySources, undefined);
  // Malformed imported metadata cannot carry cached source contents into persistence.
  response.memorySources.sources[0].content = "private snapshot";
  saveConversations(owner, [conversation]);
  assert.equal(stored.get(conversationStorageKey(owner)).includes("private snapshot"), false);
  saveConversations(owner, [{ ...conversation, temporary: true }]);
  assert.equal(stored.get(conversationStorageKey(owner)).includes("memorySources"), false);
});

test("actual route and UI bind attribution to prompt assembly, current generation, private inspection, and sanitized shares", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const route = read("src/routes/api/chat.ts"),
    page = read("src/routes/index.tsx");
  assert.match(route, /\.select\("id, title, summary, updated_at"\)/);
  assert.match(route, /id: r\.id/);
  assert.doesNotMatch(route, /chat-memory-\$/);
  assert.match(route, /formatMemoryBlock\(selectedMemories\)/);
  assert.match(
    route,
    /if \(conversationSummary\) \{\s*memorySourceRefs\.push\(\{\s*kind: "conversation_summary",\s*id: conversationSummary\.source\.id/,
  );
  assert.equal((route.match(/sseEvent\(\s*memorySourcesDelta/g) ?? []).length, 2);
  assert.match(page, /createMemorySourceUpdater\(\s*userKey,\s*tempChat,/);
  assert.match(page, /assistantMsg\.id,\s*isCurrentRequest,\s*setConversations/);
  const fn = read("src/lib/memory-sources.functions.ts");
  assert.match(fn, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(fn, /inspectMemorySources\(context\.supabase, context\.userId, data\)/);
  assert.match(fn, /private, no-store/);
  assert.match(read("src/components/ChatMessage.tsx"), /Memory provided/);
  assert.match(
    read("src/components/ShareChatDialog.tsx"),
    /\.map\(\(m\) => \(\{ role: m\.role, content: m\.content/,
  );
});
