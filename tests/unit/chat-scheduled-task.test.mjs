import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as policy from "../../src/lib/scheduled-task-policy.mjs";
import * as receipts from "../../src/lib/task-created-receipt.mjs";
import { messageActivitiesFromDelta } from "../../src/lib/message-activity-list.mjs";

const request = new Request("https://kovagpt.com/api/chat", { method: "POST" });
const userId = "22222222-2222-4222-8222-222222222222";
const args = {
  title: "Read a chapter",
  prompt: "Remind me to read a chapter.",
  localTime: "2027-03-12T19:30",
  timezone: "America/New_York",
  repeat: "daily",
};
function load(persistScheduledTask) {
  const exports = {};
  const modules = {
    "node:crypto": crypto,
    zod: { z },
    "@/lib/scheduled-task-policy.mjs": policy,
    "@/lib/task-created-receipt.mjs": receipts,
    "@/lib/scheduled-tasks.functions": { persistScheduledTask },
  };
  const source = readFileSync("src/lib/chat-scheduled-task.server.ts", "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, { exports, require: (specifier) => modules[specifier], Error });
  return exports;
}

test("chat task uses shared persistence, retries with the same identity, and emits a verified receipt", async () => {
  const writes = [];
  const { createChatScheduledTask, requestsScheduledTask } = load(
    async (owner, input, original) => {
      assert.equal(owner, userId);
      assert.equal(original, request);
      writes.push(input);
      return {
        id: input.id,
        title: input.payload.title,
        next_run_at: "2027-03-13T00:30:00Z",
        timezone: input.payload.timezone,
        repeat: input.payload.repeat,
      };
    },
  );
  assert.equal(requestsScheduledTask("Could you remind me to read tomorrow at 7:30 PM?"), true);
  assert.equal(requestsScheduledTask("How do I schedule a reminder?"), false);
  assert.equal(requestsScheduledTask("Schedule a meeting with Bob"), false);
  const turn = { request, userId, turnId: "test-turn", args };
  const first = await createChatScheduledTask(turn);
  const replay = await createChatScheduledTask(turn);
  assert.equal(first.status, "created");
  assert.equal(replay.receipt.taskId, first.receipt.taskId);
  assert.equal(writes[0].id, writes[1].id);
  assert.equal(writes[0].mutationId, writes[1].mutationId);
  assert.equal(writes[0].payload.timezone, "America/New_York");
  const [activity] = messageActivitiesFromDelta([], {
    tool: "scheduled_task",
    label: "Scheduled task created",
    status: "done",
    taskReceipt: first.receipt,
  });
  assert.equal(receipts.taskCreationNotice(activity).taskId, first.receipt.taskId);
});

test("invalid schedules never write, and scheduler outages never emit a success receipt", async () => {
  let writes = 0;
  const { createChatScheduledTask } = load(async () => {
    writes++;
    throw new Error("Background execution is not ready. Your task was not started.");
  });
  const turn = { request, userId, turnId: "test-turn", args };
  assert.equal(
    (await createChatScheduledTask({ ...turn, args: { ...args, localTime: "tomorrow" } })).status,
    "not-created",
  );
  assert.equal(writes, 0);
  assert.equal((await createChatScheduledTask(turn)).status, "not-created");
  assert.equal(writes, 1);
});

test("a time clarification keeps the original user request without injecting assistant instructions", () => {
  const { scheduledTaskRequestText } = load(() => assert.fail("classification must not write"));
  const initial = { role: "user", content: "Remind me to read a chapter every day" };
  const question = { role: "assistant", content: "What time should I remind you?" };
  const answer = { role: "user", content: "10:30 am" };
  const combined = scheduledTaskRequestText([initial, question, answer], answer.content);
  assert.match(combined, /read a chapter every day/);
  assert.match(combined, /10:30 am/);
  assert.doesNotMatch(combined, /What time/);
  assert.equal(scheduledTaskRequestText([question, answer], answer.content), null);
});
