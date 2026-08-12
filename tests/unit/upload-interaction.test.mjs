import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const composer = readFileSync("src/components/ChatInput.tsx", "utf8");

test("drag and drop uses the same bounded attachment validation path", () => {
  assert.match(composer, /handleDrop[\s\S]*await addFiles\(files\)/);
  assert.match(composer, /handlePaste[\s\S]*await addFiles\(files\)/);
  assert.match(composer, /Drop up to two supported files/);
  assert.match(composer, /dropEffect = "copy"/);
  assert.match(composer, /MAX_TEXT_FILE_BYTES/);
  assert.match(composer, /MAX_IMAGE_FILE_BYTES/);
});

test("removing an in-progress attachment prevents a late read from restoring it", () => {
  assert.match(composer, /cancelledAttachmentKeysRef/);
  assert.match(composer, /cancelledAttachmentKeysRef\.current\.has\(duplicateKey\)/);
  assert.match(composer, /nextAttachments\.filter\(\(attachment\) => attachment !== uploading\)/);
  assert.match(composer, /setUploadAnnouncement\(`\$\{attachment\.name\} removed`\)/);
});
