import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  developerFileReferences,
  developerFileUpload,
  expandDeveloperFileContent,
} from "../../src/lib/pricing/developer-file-policy.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const body = { model: "kova-fast", input: "Summarize the attachment.", max_output_tokens: 100 };
const file = (content = "Name,Count\nA,1") => ({
  id,
  filename: "report.csv",
  mime_type: "text/csv",
  content,
  byte_size: Buffer.byteLength(content),
  content_digest: createHash("sha256").update(content).digest("hex"),
  expires_at: new Date(Date.now() + 60000).toISOString(),
});
test("only explicit bounded owned-text references can become quoted model input", () => {
  assert.deepEqual(developerFileReferences("responses", { ...body, file_ids: [id] }), {
    body,
    ids: [id],
  });
  for (const ids of [[], [id, id], Array(5).fill(id), ["https://private.invalid"], [null]])
    assert.throws(
      () => developerFileReferences("responses", { ...body, file_ids: ids }),
      /file_invalid/,
    );
  assert.throws(
    () => developerFileReferences("images", { ...body, file_ids: [id] }),
    /file_invalid/,
  );
  const source = file();
  const expanded = expandDeveloperFileContent(body, [source]);
  assert.equal(expanded.bindings[0].digest, source.content_digest);
  assert.equal(expanded.expiresAt, Date.parse(source.expires_at));
  assert.ok(expanded.body.input[1].content.endsWith(source.content));
  assert.ok(expanded.body.input[1].content.includes(id));
  assert.equal(body.input, "Summarize the attachment.");
  for (const patch of [
    { byte_size: 0 },
    { expires_at: new Date(Date.now() - 1).toISOString() },
    { content_digest: "bad" },
  ])
    assert.throws(
      () => expandDeveloperFileContent(body, [{ ...source, ...patch }]),
      /file_invalid/,
    );
  assert.throws(
    () => expandDeveloperFileContent(body, [file("x".repeat(32768)), file("x".repeat(32768))]),
    /too_large/,
  );
});
test("file uploads enforce UTF-8 byte bounds, document type and parsed JSON without hidden URL reads", () => {
  const good = { filename: "data.json", mimeType: "application/json", text: '{"x":1}' };
  assert.deepEqual(developerFileUpload(good), good);
  for (const patch of [
    { filename: "../data.json" },
    { mimeType: "text/html" },
    { text: "bad json" },
    { text: "\0" },
    { text: "é".repeat(16385) },
    { url: "https://private.invalid" },
  ])
    assert.throws(() => developerFileUpload({ ...good, ...patch }), /file_invalid/);
});
