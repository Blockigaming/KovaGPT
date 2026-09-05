import assert from "node:assert/strict";
import test from "node:test";
import {
  embeddingRows,
  processWorkspaceSearchJobs,
  searchWorkspace,
} from "../../src/lib/workspace-search-policy.server.mjs";
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
test("provider vectors require exact dimensions, finite values, unique indexes, and nonzero norms", () => {
  assert.deepEqual(embeddingRows({ data: [{ index: 0, embedding: vector }] }, 1), [vector]);
  for (const value of [[], Array(1536).fill(0), Array(1536).fill(NaN), Array(1536).fill(Infinity)])
    assert.throws(() => embeddingRows({ data: [{ index: 0, embedding: value }] }, 1));
  assert.throws(() =>
    embeddingRows(
      {
        data: [
          { index: 0, embedding: vector },
          { index: 0, embedding: vector },
        ],
      },
      2,
    ),
  );
});
test("worker batches are bounded and use only generation/lease guarded settlement", async () => {
  const calls = [];
  const jobs = [
    { id: "a", revision: 2, lease_token: "new", input_text: "Launch" },
    { id: "b", revision: 1, lease_token: "one", input_text: "Other" },
  ];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return { data: name.startsWith("claim") ? jobs : args.p_id === "a" };
  };
  const result = await processWorkspaceSearchJobs({
    rpc,
    embed: async (input) => input.map(() => vector),
    model: "embedding-v1",
  });
  assert.deepEqual(result, { claimed: 2, completed: 1, retrying: 0, superseded: 1 });
  assert.equal(calls[1].args.p_lease, "new");
  assert.equal(calls[1].args.p_revision, 2);
  const failed = await processWorkspaceSearchJobs({
    rpc,
    embed: async () => {
      throw new Error("provider down");
    },
    model: "embedding-v1",
  });
  assert.equal(failed.retrying, 1);
  assert.equal(calls.at(-1).args.p_embedding, null);
});
test("provider failure or semantic database failure falls back to current-access keyword search", async () => {
  let called = 0;
  let embedded = 0;
  const rpc = async (name, args) => {
    called++;
    return args.p_embedding
      ? { error: "semantic unavailable" }
      : { data: [{ semantic: false, title: "current" }] };
  };
  const result = await searchWorkspace({
    rpc,
    embed: async () => {
      embedded++;
      return [vector];
    },
    model: "m",
    query: "plan",
    semanticAllowed: true,
  });
  assert.equal(result.mode, "keyword");
  assert.equal(called, 2);
  assert.equal(embedded, 1);
  await searchWorkspace({
    rpc,
    embed: async () => {
      throw new Error("must not call");
    },
    model: "m",
    query: "plan",
    semanticAllowed: false,
  });
  assert.equal(embedded, 1);
  await assert.rejects(
    searchWorkspace({
      rpc: async () => ({ error: "RLS backend down" }),
      embed: async () => [],
      model: "m",
      query: "plan",
      semanticAllowed: false,
    }),
    /unavailable/,
  );
});
