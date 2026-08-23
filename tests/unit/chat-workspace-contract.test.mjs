import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RULES_LENGTH,
  composeInstructionLayers,
  parseBranchInput,
  parseChatId,
  parseCustomRulesInput,
  parseMessageVersionInput,
  parsePinInput,
  parseUnpinInput,
  renderInstructionLayers,
} from "../../src/lib/chat-workspace-contract.mjs";

const UUID = "3f6b1c2e-4a5d-4b7c-8d9e-0a1b2c3d4e5f";

test("chat ids must be present and shape-safe", () => {
  assert.equal(parseChatId(" chat-123 "), "chat-123");
  assert.throws(() => parseChatId(""), /chat id is required/);
  assert.throws(() => parseChatId(undefined), /chat id is required/);
  assert.throws(() => parseChatId("chat id"), /not valid/);
  assert.throws(() => parseChatId("a".repeat(200)), /too long/);
});

test("message versions reject empty edits and invalid selection ranges", () => {
  const parsed = parseMessageVersionInput({
    chatId: "c1",
    messageId: "m1",
    content: "Revised paragraph.",
    instruction: "  make it shorter  ",
    selectionStart: 4,
    selectionEnd: 12,
  });
  assert.equal(parsed.instruction, "make it shorter");
  assert.equal(parsed.selectionStart, 4);

  assert.throws(
    () => parseMessageVersionInput({ chatId: "c1", messageId: "m1", content: "   " }),
    /cannot be empty/,
  );
  assert.throws(
    () =>
      parseMessageVersionInput({
        chatId: "c1",
        messageId: "m1",
        content: "x",
        selectionStart: 9,
        selectionEnd: 2,
      }),
    /selection range is not valid/,
  );
  assert.throws(
    () =>
      parseMessageVersionInput({
        chatId: "c1",
        messageId: "m1",
        content: "x",
        selectionStart: -1,
      }),
    /whole number/,
  );
});

test("branch input defaults to active and normalizes optional fields", () => {
  const parsed = parseBranchInput({ chatId: "c1", label: "   " });
  assert.equal(parsed.label, null);
  assert.equal(parsed.isActive, true);
  assert.equal(parseBranchInput({ chatId: "c1", isActive: false }).isActive, false);
});

test("custom rules are length bounded and default to enabled", () => {
  assert.equal(parseCustomRulesInput({ chatId: "c1" }).enabled, true);
  assert.equal(parseCustomRulesInput({ chatId: "c1", rules: "" }).rules, "");
  assert.throws(
    () => parseCustomRulesInput({ chatId: "c1", rules: "a".repeat(MAX_RULES_LENGTH + 1) }),
    /characters or fewer/,
  );
});

test("pins require a file reference and validate uuids", () => {
  assert.throws(() => parsePinInput({ chatId: "c1" }), /file is required/);
  assert.equal(parsePinInput({ chatId: "c1", fileId: UUID }).fileId, UUID);
  assert.equal(parsePinInput({ chatId: "c1", fileName: "notes.pdf" }).fileId, null);
  assert.throws(() => parsePinInput({ chatId: "c1", fileId: "nope" }), /not valid/);
  assert.throws(() => parseUnpinInput({ chatId: "c1", pinId: "nope" }), /not valid/);
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
