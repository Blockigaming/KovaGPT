import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  REVIEW_OWNER,
  REVIEW_OUTPUT_CHAT_ID,
  REVIEW_OUTPUT_LIBRARY_ID,
  reviewConversations,
} from "../../review-kit/private-http-review.mjs";
import { IMAGE_REVIEW_DATA_URL } from "../../review-kit/image-review-fixture.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";

// Exercise the actual pure output derivation without a browser or app build.
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in modules, `Unexpected import ${name}`);
    return modules[name];
  });
  return exports;
}
const artifacts = load("../../src/components/artifact-utils.ts");
const urls = load("../../src/lib/safe-url.ts");
const imageUrls = load("../../src/lib/safe-image-url.ts", { "./safe-url.ts": urls });
const { conversationOutputs } = load("../../src/lib/conversation-outputs.ts", {
  "../components/artifact-utils": artifacts,
  "./safe-image-url": imageUrls,
});

test("default review chats stay unchanged and output-free until the explicit scenario is selected", () => {
  const defaults = reviewConversations();
  assert.equal(defaults.length, 2);
  assert.deepEqual(
    defaults.map((chat) => chat.title),
    ["Composer review chat", "Second review chat"],
  );
  assert.deepEqual(defaults.map(conversationOutputs), [[], []]);
  assert.deepEqual(reviewConversations("tasks-editor"), defaults);
  const withOutputs = reviewConversations("chat-outputs");
  assert.equal(withOutputs.length, 3);
  assert.deepEqual(withOutputs.slice(0, 2), defaults);
  withOutputs[2].messages[0].attachments[0].content = "Changed in one test only";
  assert.notEqual(
    reviewConversations("chat-outputs")[2].messages[0].attachments[0].content,
    "Changed in one test only",
  );
});

test("chat-outputs produces four genuine output kinds accepted unchanged by chat history policy", () => {
  const chat = reviewConversations("chat-outputs").at(-1);
  assert.equal(chat.id, REVIEW_OUTPUT_CHAT_ID);
  assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER), chat);
  const outputs = conversationOutputs(chat);
  assert.deepEqual(
    outputs.map((output) => output.kind),
    ["text", "image", "library", "library", "artifact"],
  );
  assert.equal(outputs[0].name, "review-checklist.txt");
  assert.equal(outputs[0].extracted, false);
  assert.equal(outputs[0].downloadName, "review-checklist.txt");
  assert.match(outputs[0].content, /Synthetic review checklist/);
  assert.equal(outputs[1].source, IMAGE_REVIEW_DATA_URL);
  assert.match(outputs[1].source, /^data:image\/jpeg;base64,/);
  assert.equal(outputs[2].name, "Notes.txt");
  assert.equal(outputs[2].libraryItemId, REVIEW_OUTPUT_LIBRARY_ID);
  assert.equal(outputs[2].content, undefined);
  assert.equal(outputs[3].name, "Synthetic unavailable historical file.txt");
  assert.equal(outputs[3].content, undefined);
  assert.equal(outputs[4].artifactKind, "code");
  assert.equal(outputs[4].messageId, "outputs-answer");
  assert.match(outputs[4].content, /const checklist =/);
  assert.doesNotMatch(outputs[4].content, /```/);
  assert.match(chat.messages[1].content, /No code was executed and no AI provider was called/);
});

test("source activity scenarios are explicit synthetic snapshots and preserve ordinary chats", () => {
  for (const [scenario, status] of [["chat-sources-used", "done"]]) {
    const rows = reviewConversations(scenario);
    assert.deepEqual(rows.slice(0, 2), reviewConversations());
    const chat = rows.at(-1);
    assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER), chat);
    assert.equal(chat.messages[1].activities[0].status, status);
    assert.match(chat.messages[1].activities[0].label, /Sample.*no live session/);
    assert.match(chat.messages[1].sources[0].snippet, /Synthetic.*No web research/);
    assert.equal(chat.messages[1].memorySources.ownerId, REVIEW_OWNER);
  }
  assert.equal(reviewConversations("chat-outputs").at(-1).messages[1].activities, undefined);
});
