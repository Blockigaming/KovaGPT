import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  sketchMentionStart,
  trailingComposerMention,
} from "../../src/lib/composer-sketch-mention.mjs";

test("Sketch suggestion is available at a trailing @ mention", () => {
  for (const draft of ["@", "@s", "@sk", "@ske", "@sketc", "@Sketch"]) {
    assert.equal(sketchMentionStart(draft), 0, draft);
  }
  assert.equal(sketchMentionStart("Draw an idea @sk"), 13);
  assert.equal(sketchMentionStart("First line\n@sketch"), 11);
});

test("mentions do not hijack email, ordinary text or unsupported tools", () => {
  for (const draft of [
    "",
    "contact@example.com",
    "test@sketch",
    "@research",
    "@screenshot",
    "please @sketch tomorrow",
    "@Sketch!",
  ]) {
    assert.equal(sketchMentionStart(draft), -1, draft);
  }
  assert.equal(sketchMentionStart(null), -1);
});

test("composer offers the real drawing dialog and not a fake attachment", () => {
  const source = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(source, /sketchMentionStart\(value\)/);
  assert.match(source, /onClick=\{acceptSketchMention\}/);
  assert.match(source, /setDrawingOpen\(true\)/);
  assert.match(source, /<ComposerDrawingDialog/);
});

test("tool mention parser updates as text changes and ignores email addresses", () => {
  assert.deepEqual(trailingComposerMention("Use @se"), { start: 4, query: "se" });
  assert.deepEqual(trailingComposerMention("Start\n@DATA"), { start: 6, query: "data" });
  for (const value of ["hello@example.com", "@search then", "text@image", null]) {
    assert.equal(trailingComposerMention(value), null);
  }
});

test("tool mentions call real composer selection rather than writing a fake mention", () => {
  const source = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(source, /matchingToolMentions\.map\(/);
  assert.match(source, /onToolSelect\?\.\(tool\.id\)/);
  assert.match(source, /onChange\(value\.slice\(0, toolMentionAt\)\)/);
});
