import assert from "node:assert/strict";
import test from "node:test";
import { developerVector, parseDeveloperVectorRequest } from "../../src/lib/pricing/developer-vector-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const parse = (method, query = "", body) =>
  parseDeveloperVectorRequest(method, new URLSearchParams(query), body);
test("vector operations reject nonfinite, zero, oversized and malformed embeddings", () => {
  assert.deepEqual(developerVector([1, 0, -1]), [1, 0, -1]);
  for (const value of [[], [0, 0], [Infinity], [NaN], ["1"], [1e7], [1, 1e-14], Array(1537).fill(1)])
    assert.throws(() => developerVector(value), /vector_invalid/);
});
test("vector resource operations are explicit and bounded with no caller ownership claims", () => {
  assert.deepEqual(parse("GET"), { operation: "list", input: {} });
  assert.deepEqual(parse("GET", `id=${id}&entries=true&page=1`), {
    operation: "list_entries",
    input: { store_id: id, page: 1 },
  });
  assert.equal(parse("DELETE", `id=${id}&entry_id=item`).operation, "delete_entry");
  const body = { operation: "search", store_id: id, model: "kova-embedding", vector: [1, 0] };
  assert.equal(parse("POST", "", body).input.limit, 5);
  for (const bad of [
    { ...body, owner_id: id },
    { ...body, limit: 21 },
    { ...body, vector: [0, 0] },
    { ...body, store_id: "../files" },
  ])
    assert.throws(() => parse("POST", "", bad), /vector_invalid/);
  for (const query of [`id=${id}&id=${id}`, "entries=true", `id=${id}&entries=true&page=20`])
    assert.throws(() => parse("GET", query), /vector_invalid/);
});
