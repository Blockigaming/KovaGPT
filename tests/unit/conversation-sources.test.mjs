import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as memorySources from "../../src/lib/memory-sources.mjs";
import * as responseSourceTime from "../../src/lib/response-source-time.mjs";

function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in modules, `Unexpected import ${name}`);
    return modules[name];
  });
  return exports;
}

const { conversationSources } = load("src/lib/conversation-sources.ts", {
  "./memory-sources.mjs": memorySources,
  "./response-sources": load("src/lib/response-sources.ts", {
    "./response-source-time.mjs": responseSourceTime,
  }),
});
const ownerId = "10000000-0000-4000-8000-000000000001";
const otherOwnerId = "10000000-0000-4000-8000-000000000002";
const memoryId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const chat = {
  id: "chat-a",
  title: "Synthetic source inventory test",
  mode: "instant",
  createdAt: 1,
  updatedAt: 1,
  messages: [],
};
const assistant = (id, extra = {}) => ({ id, role: "assistant", content: "", ...extra });
const source = (url, extra = {}) => ({ id: "src-1", title: "Recorded source", url, ...extra });

test("empty or prose-only conversations never invent sources, memory or browser state", () => {
  const empty = { web: [], memory: [], attachments: [], browser: [] };
  assert.deepEqual(conversationSources(chat, ownerId), empty);
  assert.deepEqual(
    conversationSources({
      ...chat,
      messages: [
        assistant("a", {
          content: "I browsed https://example.test and used your saved memory and file.",
          requestedTool: "web_search",
          activities: [
            { tool: "search_web", label: "Searching the web", status: "running" },
            { tool: "read_source", label: "Read a source", status: "done" },
            { tool: "browser", label: "Browser connected", status: "done" },
          ],
        }),
      ],
    }),
    empty,
  );
});

test("web inventory normalizes recorded assistant metadata and groups repeated URLs", () => {
  const result = conversationSources({
    ...chat,
    messages: [
      { id: "u", role: "user", content: "", sources: [source("https://user-only.test")] },
      assistant("a", {
        sources: [
          source("https://name:secret@EXAMPLE.test/report#part", { domain: "spoofed.test" }),
          source("javascript:alert(1)"),
          source("data:text/html,unsafe"),
          source("/relative"),
        ],
      }),
      assistant("b", {
        sources: [
          source("https://example.test/report#another"),
          source("https://example.test/Other"),
        ],
      }),
      assistant("c", { sources: [source("https://example.test/other")] }),
    ],
  });
  assert.equal(result.web.length, 3);
  assert.deepEqual(result.web[0].messageIds, ["a", "b"]);
  assert.equal(result.web[0].source.url, "https://example.test/report");
  assert.equal(result.web[0].source.domain, "example.test");
  assert.equal(result.web[0].usage, "provided");
  assert.deepEqual(result.browser, []);
});

test("only valid current-owner response memory is shown and never claims influence", () => {
  const references = [
    { kind: "chat_memory", id: memoryId, title: "Private title", content: "Private body" },
    { kind: "project_memory", id: memoryId, projectId },
    { kind: "conversation_summary", id: memoryId },
    { kind: "chat_memory", id: "invalid" },
    { kind: "project_memory", id: memoryId, projectId: "invalid" },
  ];
  const conversation = {
    ...chat,
    messages: [
      {
        id: "u",
        role: "user",
        content: "",
        memorySources: { ownerId, sources: [{ kind: "chat_memory", id: projectId }] },
      },
      assistant("a", { memorySources: { ownerId, sources: references } }),
      assistant("b", { memorySources: { ownerId, sources: references } }),
      assistant("other", {
        memorySources: { ownerId: otherOwnerId, sources: references },
      }),
    ],
  };
  const result = conversationSources(conversation, ownerId);
  assert.equal(result.memory.length, 3);
  for (const row of result.memory) {
    assert.deepEqual(row.messageIds, ["a", "b"]);
    assert.equal(row.ownerId, ownerId);
    assert.equal(row.usage, "provided");
    assert.deepEqual(row.sources, { ownerId, sources: [row.source] });
    assert.equal(row.source.content, undefined);
    assert.equal(row.source.title, undefined);
  }
  assert.doesNotMatch(JSON.stringify(result), /Private title|Private body/);
  assert.deepEqual(conversationSources(conversation).memory, []);
  assert.deepEqual(conversationSources(conversation, "not-an-owner").memory, []);
  assert.deepEqual(conversationSources({ ...conversation, temporary: true }, ownerId).memory, []);
  assert.equal(conversationSources(conversation, otherOwnerId).memory.length, 3);
});

test("input attachments stay available and point to existing outputs without exposing bodies", () => {
  const result = conversationSources({
    ...chat,
    messages: [
      {
        id: "u",
        role: "user",
        content: "Read these files",
        attachments: [
          { kind: "text_file", name: "notes.txt", content: "Private file body" },
          { kind: "library_file", name: "Saved report", libraryItemId: "library-1" },
          { kind: "image", dataUrl: "data:image/png;base64,AAAA" },
        ],
      },
      assistant("a", {
        content: "I read every file.",
        activities: [{ tool: "process_document", label: "Read file", status: "done" }],
        attachments: [{ kind: "image", dataUrl: "data:image/png;base64,BBBB" }],
      }),
    ],
  });
  assert.equal(result.attachments.length, 3);
  assert.deepEqual(
    result.attachments.map(({ outputId, usage, messageId, attachmentIndex }) => ({
      outputId,
      usage,
      messageId,
      attachmentIndex,
    })),
    [0, 1, 2].map((attachmentIndex) => ({
      outputId: `u:attachment:${attachmentIndex}`,
      usage: "available",
      messageId: "u",
      attachmentIndex,
    })),
  );
  assert.equal(result.attachments[2].name, "Image 3");
  assert.doesNotMatch(JSON.stringify(result), /Private file body|base64|library-1/);
});

test("browser inventory follows only explicit exact-tool activity status", () => {
  const messages = ["running", "done", "failed", "canceled"].map((status) =>
    assistant(status, {
      activities: [{ tool: "browser_interact", label: `Synthetic browser ${status}`, status }],
    }),
  );
  const result = conversationSources({ ...chat, messages });
  assert.deepEqual(
    result.browser.map(({ status }) => status),
    ["active", "completed", "failed", "canceled"],
  );
  assert.deepEqual(
    result.browser.map(({ messageId }) => messageId),
    ["running", "done", "failed", "canceled"],
  );
  assert.equal(result.browser[0].label, "Synthetic browser running");
});

test("the latest valid browser snapshot wins, malformed and user events are ignored", () => {
  const activity = (status) => ({ tool: "browser_interact", label: status, status });
  const result = conversationSources({
    ...chat,
    messages: [
      { id: "u", role: "user", content: "", activities: [activity("done")] },
      assistant("a", {
        activities: [activity("running"), activity("done"), activity("made-up")],
      }),
      assistant("b", {
        activities: [
          activity("complete"),
          activity("__proto__"),
          { tool: "browser_interact", status: "done", label: null },
          { tool: "browser_interact_extra", status: "running", label: "Not the tool" },
        ],
      }),
    ],
  });
  assert.equal(result.browser.length, 1);
  assert.equal(result.browser[0].status, "completed");
  assert.equal(result.browser[0].messageId, "a");
});

test("derivation is deterministic, isolated to the supplied chat, and does not mutate inputs", () => {
  const conversation = {
    ...chat,
    messages: [
      assistant("a", {
        sources: [source("https://example.test")],
        memorySources: { ownerId, sources: [{ kind: "chat_memory", id: memoryId }] },
        activities: [{ tool: "browser_interact", label: "Synthetic event", status: "done" }],
      }),
    ],
  };
  const original = structuredClone(conversation);
  assert.deepEqual(
    conversationSources(conversation, ownerId),
    conversationSources(conversation, ownerId),
  );
  assert.deepEqual(conversation, original);
  assert.deepEqual(conversationSources(chat, ownerId), {
    web: [],
    memory: [],
    attachments: [],
    browser: [],
  });
});
