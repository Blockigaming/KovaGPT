import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadBatcher() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/feedback-batch.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, queueMicrotask, Map, Promise, Error },
  );
  return exports;
}

test("same-owner feedback hydration coalesces and deduplicates message IDs", async () => {
  const { loadResponseFeedbackBatched } = loadBatcher();
  const calls = [];
  const fetcher = async (messageIds) => {
    calls.push(messageIds);
    return { "message-1": "up", "message-2": "down" };
  };

  const ratings = await Promise.all([
    loadResponseFeedbackBatched("owner-a", "message-1", fetcher),
    loadResponseFeedbackBatched("owner-a", "message-2", fetcher),
    loadResponseFeedbackBatched("owner-a", "message-1", fetcher),
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0]], ["message-1", "message-2"]);
  assert.deepEqual([...ratings], ["up", "down", "up"]);
});

test("feedback hydration separates owners and bounds every server batch", async () => {
  const { loadResponseFeedbackBatched } = loadBatcher();
  const calls = [];
  const fetcher = async (messageIds) => {
    calls.push(messageIds);
    return {};
  };
  const many = Array.from({ length: 201 }, (_, index) =>
    loadResponseFeedbackBatched("owner-a", `message-${index}`, fetcher),
  );
  many.push(loadResponseFeedbackBatched("owner-b", "message-b", fetcher));
  await Promise.all(many);

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.length).sort((a, b) => a - b),
    [1, 1, 200],
  );
});

test("a failed hydration batch rejects together and a later retry starts fresh", async () => {
  const { loadResponseFeedbackBatched } = loadBatcher();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return { "message-1": "up" };
  };

  const failed = await Promise.allSettled([
    loadResponseFeedbackBatched("owner-a", "message-1", fetcher),
    loadResponseFeedbackBatched("owner-a", "message-2", fetcher),
  ]);
  assert.deepEqual(
    failed.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(await loadResponseFeedbackBatched("owner-a", "message-1", fetcher), "up");
  assert.equal(calls, 2);
});
