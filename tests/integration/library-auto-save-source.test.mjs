import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const [hook, library, images, imageRoute] = await Promise.all([
  read("src/hooks/use-library-attachment-auto-save.ts"),
  read("src/lib/library.functions.ts"),
  read("src/lib/library-images.functions.ts"),
  read("src/routes/images.tsx"),
]);

test("accepted uploads auto-save only after complete eligible acceptance", () => {
  assert.match(hook, /candidate\.status === "complete"/);
  assert.match(hook, /candidate\.source === "file_upload"/);
  assert.match(hook, /candidate\.source === "long_paste"/);
  assert.match(hook, /candidate\.kind === "image"/);
  assert.match(hook, /candidate\.kind === "text_file"/);
  assert.doesNotMatch(hook, /tryUseUpload|increment|consume/i);
});

test("attachment auto-save supports text, Markdown, and images without blocking chat", () => {
  assert.match(hook, /saveImage\(\{/);
  assert.match(hook, /saveItem\(\{/);
  assert.match(hook, /file_type: attachment\.fileType/);
  assert.match(hook, /void persist\(attachment\)/);
  assert.match(hook, /not saved to your Library/);
  assert.match(hook, /label: "Retry"/);
});

test("generic Library saves deduplicate with an owner-scoped UUID", () => {
  assert.match(library, /idempotencyKey: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(library, /\.eq\("id", data\.idempotencyKey\)/);
  assert.match(library, /\.eq\("user_id", context\.userId\)/);
  assert.match(library, /const concurrent = await findOwnedItem\(\)/);
  assert.match(library, /id: data\.idempotencyKey/);
});

test("image Library saves use a deterministic private path and safe concurrent retry", () => {
  assert.match(images, /idempotencyKey: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(images, /data\.idempotencyKey \?\? crypto\.randomUUID\(\)/);
  assert.match(images, /upsert: Boolean\(data\.idempotencyKey\)/);
  assert.match(images, /const concurrent = await findOwnedImage\(\)/);
  assert.match(images, /if \(concurrent\) return \{ id: concurrent\.id \}/);
  assert.match(images, /source: data\.source/);
});

test("newly generated images auto-save with durable retry and truthful status", () => {
  assert.match(imageRoute, /libraryStatus: "saving"/);
  assert.match(imageRoute, /saveGeneratedImage\(historyItem, \{ automatic: true \}\)/);
  assert.match(imageRoute, /idempotencyKey: item\.id/);
  assert.match(imageRoute, /Saved to Library/);
  assert.match(imageRoute, /Retry Library save/);
  assert.match(imageRoute, /label: "Retry"/);
  assert.match(imageRoute, /userKeyRef\.current === operationUserKey/);
});
