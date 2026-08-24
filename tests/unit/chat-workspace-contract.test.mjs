import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_PINNED_ITEM_CHARS,
  MAX_RULES_LENGTH,
  budgetPinnedContext,
  composeInstructionLayers,
  describePinStatus,
  parseBranchActivationInput,
  parseBranchInput,
  parseChatId,
  parseCustomRulesInput,
  parseMessageId,
  parseMessageIds,
  parseMessageVersionInput,
  parsePinInput,
  parsePinStatusInput,
  parseUnpinInput,
  renderInstructionLayers,
} from "../../src/lib/chat-workspace-contract.mjs";

const UUID = "3f6b1c2e-4a5d-4b7c-8d9e-0a1b2c3d4e5f";
const UUID_B = "8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

test("chat ids must be present and shape-safe", () => {
  assert.equal(parseChatId(" chat-123 "), "chat-123");
  assert.throws(() => parseChatId(""), /chat id is required/);
  assert.throws(() => parseChatId(undefined), /chat id is required/);
  assert.throws(() => parseChatId("chat id"), /not valid/);
  assert.throws(() => parseChatId("a".repeat(300)), /too long/);
});

test("message ids are validated separately with a longer ceiling", () => {
  assert.equal(parseMessageId(" msg_1 "), "msg_1");
  assert.throws(() => parseMessageId(""), /message id is required/);
  assert.throws(() => parseMessageId("a".repeat(300)), /too long/);
});

test("message versions require a known source and non-empty content", () => {
  const parsed = parseMessageVersionInput({
    chatId: "c1",
    messageId: "m1",
    source: "inline_edit",
    content: "Revised paragraph.",
    instruction: "  make it shorter  ",
    selectionStart: 4,
    selectionEnd: 9,
    originalContent: "Long original.",
    branchId: UUID,
  });
  assert.equal(parsed.source, "inline_edit");
  assert.equal(parsed.instruction, "make it shorter");
  assert.equal(parsed.selectionStart, 4);
  assert.equal(parsed.selectionEnd, 9);
  assert.equal(parsed.branchId, UUID);
  assert.equal(parsed.accepted, true);

  assert.throws(
    () => parseMessageVersionInput({ chatId: "c1", messageId: "m1", content: "x" }),
    /version source is not valid/,
  );
  assert.throws(
    () =>
      parseMessageVersionInput({
        chatId: "c1",
        messageId: "m1",
        source: "nope",
        content: "x",
      }),
    /version source is not valid/,
  );
  assert.throws(
    () =>
      parseMessageVersionInput({
        chatId: "c1",
        messageId: "m1",
        source: "original",
        content: "   ",
      }),
    /cannot be empty/,
  );
  assert.throws(
    () =>
      parseMessageVersionInput({
        chatId: "c1",
        messageId: "m1",
        source: "original",
        content: "a".repeat(MAX_MESSAGE_CONTENT_LENGTH + 1),
      }),
    /too long to save/,
  );
});

test("branch input mirrors the production lineage columns", () => {
  const parsed = parseBranchInput({
    chatId: "c1",
    conversationId: "conv-1",
    parentBranchId: UUID,
    branchFromParentMessageId: "m3",
    branchFromMessageId: "m4",
    branchFromMessageIndex: 2,
    messageIds: ["m1", "m2"],
    label: "   ",
  });
  assert.equal(parsed.conversationId, "conv-1");
  assert.equal(parsed.parentBranchId, UUID);
  assert.equal(parsed.branchFromMessageIndex, 2);
  assert.deepEqual(parsed.messageIds, ["m1", "m2"]);
  assert.equal(parsed.label, null);
  assert.equal(parsed.active, true);
  assert.equal(
    parseBranchInput({ chatId: "c1", conversationId: "conv-1", active: false }).active,
    false,
  );
  assert.throws(() => parseBranchInput({ chatId: "c1" }), /conversation id is required/);
  assert.throws(
    () => parseBranchInput({ chatId: "c1", conversationId: "conv-1", parentBranchId: "nope" }),
    /not valid/,
  );
  assert.throws(
    () => parseBranchInput({ chatId: "c1", conversationId: "conv-1", branchFromMessageIndex: -1 }),
    /whole number/,
  );
  assert.deepEqual(parseMessageIds(null), []);
  assert.throws(() => parseMessageIds("m1"), /must be a list/);
});

test("branch activation requires a real branch uuid", () => {
  assert.deepEqual(parseBranchActivationInput({ chatId: "c1", branchId: UUID }), {
    chatId: "c1",
    branchId: UUID,
  });
  assert.throws(() => parseBranchActivationInput({ chatId: "c1", branchId: "1" }), /not valid/);
});

test("custom rules use the instructions column and stay length bounded", () => {
  assert.equal(parseCustomRulesInput({ chatId: "c1" }).enabled, true);
  assert.equal(parseCustomRulesInput({ chatId: "c1", instructions: "" }).instructions, "");
  assert.throws(
    () => parseCustomRulesInput({ chatId: "c1", instructions: "a".repeat(MAX_RULES_LENGTH + 1) }),
    /characters or fewer/,
  );
});

test("pins validate source type, project pairing and status", () => {
  const libraryPin = parsePinInput({ chatId: "c1", sourceType: "library", sourceId: UUID });
  assert.equal(libraryPin.projectId, null);
  assert.equal(libraryPin.status, "active");

  const filePin = parsePinInput({
    chatId: "c1",
    sourceType: "project_file",
    sourceId: UUID,
    projectId: UUID_B,
    status: "indexing",
  });
  assert.equal(filePin.projectId, UUID_B);
  assert.equal(filePin.status, "indexing");

  assert.throws(() => parsePinInput({ chatId: "c1", sourceId: UUID }), /source type is not valid/);
  assert.throws(
    () => parsePinInput({ chatId: "c1", sourceType: "library", sourceId: UUID, projectId: UUID_B }),
    /cannot belong to a project/,
  );
  assert.throws(
    () => parsePinInput({ chatId: "c1", sourceType: "project_file", sourceId: UUID }),
    /project is required/,
  );
  assert.throws(
    () => parsePinInput({ chatId: "c1", sourceType: "library", sourceId: UUID, status: "weird" }),
    /status is not valid/,
  );
  assert.throws(() => parseUnpinInput({ chatId: "c1", pinId: "nope" }), /not valid/);
  assert.equal(
    parsePinStatusInput({ chatId: "c1", pinId: UUID, status: "failed" }).status,
    "failed",
  );
  assert.throws(
    () => parsePinStatusInput({ chatId: "c1", pinId: UUID, status: "gone" }),
    /status is not valid/,
  );
});

test("pinned context is clamped per item and in total, and reports what was cut", () => {
  const budget = budgetPinnedContext(
    [
      { pinId: "p1", status: "active", name: "a.txt", content: "a".repeat(50) },
      { pinId: "p2", status: "active", name: "b.txt", content: "b".repeat(50) },
      { pinId: "p3", status: "active", name: "c.txt", content: "c".repeat(50) },
    ],
    { totalChars: 60, itemChars: 40 },
  );
  assert.equal(budget.items[0].includedChars, 40);
  assert.equal(budget.items[0].truncated, true);
  assert.equal(budget.items[1].includedChars, 20);
  assert.equal(budget.usedChars, 60);
  assert.equal(budget.skippedCount, 1);
  assert.equal(budget.truncated, true);

  const unavailable = budgetPinnedContext([
    { pinId: "p1", status: "permission_lost", name: "x", content: "secret" },
  ]);
  assert.equal(unavailable.items[0].content, "");
  assert.equal(unavailable.usedChars, 0);
  assert.equal(unavailable.truncated, false);

  const small = budgetPinnedContext([
    { pinId: "p1", status: "active", name: "x", content: "short" },
  ]);
  assert.equal(small.items[0].truncated, false);
  assert.ok(MAX_PINNED_ITEM_CHARS > 0);
});

test("pin statuses are described in plain language", () => {
  assert.equal(describePinStatus("active"), "available");
  assert.match(describePinStatus("permission_lost"), /no longer accessible/);
  assert.match(describePinStatus("indexing"), /still being processed/);
  assert.match(describePinStatus("whatever"), /unknown/);
});

test("instruction layers apply global then project then chat precedence", () => {
  const layers = composeInstructionLayers({
    global: "Be concise.",
    project: "  ",
    chat: "Answer in French.",
  });
  assert.deepEqual(
    layers.map((layer) => layer.scope),
    ["global", "chat"],
  );
  const rendered = renderInstructionLayers(layers);
  assert.ok(rendered.indexOf("Be concise.") < rendered.indexOf("Answer in French."));
  assert.match(rendered, /highest priority/);
  assert.equal(renderInstructionLayers([]), "");
});
