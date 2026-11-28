import assert from "node:assert/strict";
import test from "node:test";
import { parseDeveloperUploadRequest as parse } from "../../src/lib/pricing/developer-upload-policy.mjs";
const id = "55555555-5555-4555-8555-555555555555";
const p = new URLSearchParams();
test("resumable upload policy accepts exact bounded metadata and canonical byte chunks", () => {
  const create = {
    operation: "create",
    id,
    filename: "a.txt",
    mime_type: "text/plain",
    total_bytes: 3,
    sha256: "a".repeat(64),
  };
  assert.equal(parse("POST", p, create).operation, "create");
  assert.equal(
    parse("POST", p, { operation: "append", id, offset: 0, data: "YWJj" }).input.data,
    "YWJj",
  );
  for (const invalid of [
    { ...create, total_bytes: 32769 },
    { ...create, mime_type: "text/csv" },
    { ...create, extra: true },
    { operation: "append", id, offset: 0, data: "YR==" },
    { operation: "append", id, offset: -1, data: "YQ==" },
    { operation: "append", id, offset: 0, data: Buffer.alloc(8193).toString("base64") },
  ])
    assert.throws(() => parse("POST", p, invalid), /developer_/);
  assert.equal(parse("GET", new URLSearchParams({ id })).operation, "get");
  assert.throws(() => parse("GET", new URLSearchParams("id=" + id + "&id=" + id)), /developer_/);
  for (const operation of ["complete", "cancel"])
    assert.deepEqual(parse("POST", p, { operation, id }), { operation, input: { id } });
});
