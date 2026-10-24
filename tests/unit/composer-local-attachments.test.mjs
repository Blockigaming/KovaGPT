import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentPreviewWindow,
  prepareLocalPaste,
  utf8TextBytes,
  pasteAttachmentIntoDraft,
} from "../../src/lib/composer-local-attachments.mjs";

test("UTF-8 counts match TextEncoder without allocating full-text byte arrays", () => {
  for (const value of [
    "",
    "ascii",
    "é中文",
    "🙂",
    "\ud800",
    "\udc00",
    "a\ud800b",
    "🙂".repeat(30_000),
  ])
    assert.equal(utf8TextBytes(value), new TextEncoder().encode(value).length);
});
test("local paste retains exact whitespace and rejects oversized text without truncation", () => {
  const value = "  a\r\n\tb 🙂 \n";
  assert.equal(prepareLocalPaste(value).text, value);
  assert.throws(() => prepareLocalPaste("x".repeat(80_001)), /nothing has been truncated/);
  assert.throws(() => prepareLocalPaste("中".repeat(70_000)), /nothing has been truncated/);
});
test("bounded preview pages reconstruct all content without splitting surrogate pairs", () => {
  const value = "x".repeat(3_999) + "🙂" + "中".repeat(9_000) + " end  ";
  const parts = [];
  let start = 0;
  while (start < value.length) {
    const window = attachmentPreviewWindow(value, start);
    assert.ok(window.text.length <= 4_000);
    assert.equal(window.start, start);
    assert.ok(window.end > start);
    parts.push(window.text);
    start = window.end;
  }
  assert.equal(parts.join(""), value);
});
test("back-to-text does not overwrite changed input", () => {
  const origin = { original: "before selected after", start: 7, end: 15 };
  assert.equal(pasteAttachmentIntoDraft(origin.original, "EXACT", origin), "before EXACT after");
  assert.equal(pasteAttachmentIntoDraft("new draft", "EXACT", origin), "new draft\n\nEXACT");
});

test("removed local paste has an intentional keyboard continuation", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/ChatInput.tsx", "utf8");
  assert.match(source, /if \(attachment\?\.localPaste\) undoPasteButtonRef.current\?\.focus\(\)/);
  assert.match(source, /ref=\{undoPasteButtonRef\}/);
  assert.match(
    source,
    /Pasted text attachment restored locally\."\);\s*window.requestAnimationFrame\(\(\) => ref.current\?\.focus\(\)\)/,
  );
});
