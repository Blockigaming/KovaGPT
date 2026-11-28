import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeveloperFileSearch,
  searchDeveloperFileRecords,
} from "../../src/lib/pricing/developer-file-search-policy.mjs";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const now = 1795651200000;
const file = (id, content) => ({
  id,
  filename: "data.txt",
  content,
  byte_size: new TextEncoder().encode(content).length,
  content_digest: "a".repeat(64),
  expires_at: new Date(now + 10000).toISOString(),
});
test("file search rejects arbitrary paths, unbounded requests and duplicate file identities", () => {
  const input = { query: "revenue", file_ids: [first] };
  assert.equal(parseDeveloperFileSearch(input).limit, 5);
  for (const patch of [
    { query: "!!!" },
    { query: "x".repeat(257) },
    { query: "x".repeat(65) },
    { limit: 11 },
    { file_ids: [first, first] },
    { file_ids: ["https://private.invalid"] },
    { project_id: second },
  ])
    assert.throws(() => parseDeveloperFileSearch({ ...input, ...patch }), /search_invalid/);
});
test("lexical search ranks matching words, preserves Unicode offsets and returns no invented hits", () => {
  const request = parseDeveloperFileSearch({
    query: "revenue CAFÉ",
    file_ids: [first, second],
    limit: 2,
  });
  const files = [
    file(first, "Unrelated revenue only"),
    file(second, "📈 Revenue from café sales was higher."),
  ];
  const result = searchDeveloperFileRecords(request, files, now);
  assert.equal(result.search_type, "lexical");
  assert.equal(result.data[0].file_id, second);
  assert.equal(result.data[0].end, Array.from(files[1].content).length);
  assert.equal(result.data[0].snippet, files[1].content);
  const noMatch = parseDeveloperFileSearch({ query: "missing", file_ids: [first] });
  assert.deepEqual(searchDeveloperFileRecords(noMatch, [files[0]], now).data, []);
});
test("file retrieval refuses foreign, expired or malformed source records", () => {
  const request = parseDeveloperFileSearch({ query: "hello", file_ids: [first] });
  const original = file(first, "hello");
  for (const patch of [
    { id: second },
    { expires_at: new Date(now).toISOString() },
    { byte_size: 1 },
    { content_digest: "invalid" },
  ])
    assert.throws(
      () => searchDeveloperFileRecords(request, [{ ...original, ...patch }], now),
      /file_unavailable/,
    );
});
