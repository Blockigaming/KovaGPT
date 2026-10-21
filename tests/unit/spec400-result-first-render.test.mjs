import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeChatHistory, canonicalChatHistory } from "../../src/lib/chat-history-policy.mjs";
import { taskCreationNotice } from "../../src/lib/task-created-receipt.mjs";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const TASK = "0ad66d37-b5ee-40bd-8e5c-069de38ada89";
const created = { operation: "created", source: "persisted-result", taskId: TASK };
const failed = {
  operation: "not-created",
  source: "confirmed-result",
  reason: "Choose a future date",
};
const roundTrip = (activities) => {
  const normalized = normalizeChatHistory(
    {
      id: "receipt-chat",
      title: "Receipt roundtrip",
      mode: "instant",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: "assistant-1", role: "assistant", content: "Result", activities }],
    },
    OWNER,
  );
  return normalizeChatHistory(JSON.parse(canonicalChatHistory(normalized)), OWNER).messages[0]
    .activities;
};

test("396: durable history roundtrip retains strict confirmed task success and failure provenance", () => {
  const result = roundTrip([
    { tool: "scheduled_task", label: "Created schedule", status: "done", taskReceipt: created },
    { tool: "scheduled_task", label: "Creation rejected", status: "failed", taskFailure: failed },
  ]);
  assert.deepEqual(result[0].taskReceipt, created);
  assert.deepEqual(result[1].taskFailure, failed);
  assert.deepEqual(taskCreationNotice(result[0]), {
    success: true,
    text: "Scheduled task created",
    taskId: TASK,
  });
  assert.deepEqual(taskCreationNotice(result[1]), {
    success: false,
    text: "Scheduled task not created",
    reason: failed.reason,
  });
});

test("396: durable history rejects wrong-tool, wrong-status, malformed and synthetic receipt claims", () => {
  const input = [
    {
      tool: "other_tool",
      label: "Other operation",
      status: "done",
      taskReceipt: created,
      taskFailure: failed,
    },
    { tool: "scheduled_task", label: "Failed readback", status: "failed", taskReceipt: created },
    { tool: "scheduled_task", label: "Done", status: "done", taskFailure: failed },
    {
      tool: "scheduled_task",
      label: "Synthetic claim",
      status: "done",
      taskReceipt: { ...created, source: "synthetic-review" },
    },
    {
      tool: "scheduled_task",
      label: "Invalid ID",
      status: "done",
      taskReceipt: { ...created, taskId: "not-a-schedule" },
    },
    {
      tool: "scheduled_task",
      label: "Synthetic failure",
      status: "failed",
      taskFailure: { ...failed, source: "synthetic-review" },
    },
    {
      tool: "scheduled_task",
      label: "Unknown failure",
      status: "failed",
      taskFailure: { ...failed, reason: "" },
    },
    { tool: "scheduled_task", label: "Scheduled task created", status: "done" },
    { tool: "scheduled_task", label: "Still running", status: "running", taskReceipt: created },
  ];
  const result = roundTrip(input);
  assert.equal(
    result.length,
    input.length - 1,
    "Running activity is not durable completion evidence",
  );
  for (const activity of result) {
    assert.equal(activity.taskReceipt, undefined);
    assert.equal(activity.taskFailure, undefined);
    if (activity.tool === "scheduled_task") {
      assert.equal(taskCreationNotice(activity).success, false);
      assert.equal(taskCreationNotice(activity).text, "Scheduled task status unconfirmed");
      assert.match(
        taskCreationNotice(activity).reason,
        /check whether it was created before trying again/,
      );
    }
  }
});

test("216: primary Result actions retain one horizontal-scroll row without wrapping", () => {
  const css = readFileSync("src/components/result-editor.css", "utf8");
  assert.match(
    css,
    /\.kova-result-toolbar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/,
  );
  assert.match(
    css,
    /\.kova-result-toolbar > button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/,
  );
  const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
  const toolbar = editor.slice(
    editor.indexOf('className="kova-result-toolbar"'),
    editor.indexOf('className="kova-result-secondary-toolbar"'),
  );
  assert.match(toolbar, /Edit[\s\S]*Versions[\s\S]*Export[\s\S]*Share[\s\S]*More/);
  assert.match(
    toolbar,
    /\{onResetLayout && \([\s\S]*onSelect=\{onResetLayout\}[\s\S]*Reset layout/,
  );
});

test("54: tabbed Result layout puts reset in More and retains split controls only in wide layout", () => {
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(route, /\{wideResult && \(\s*<div className="spec400-layout-controls">/);
  assert.match(route, /onResetLayout=\{!wideResult \? \(\) => setPaneRatio\(0\.45\) : undefined\}/);
  assert.match(route, /id="result-pane"\s+tabIndex=\{-1\}/);
  assert.match(route, /scheduleResultFocus\(origin, "result", descriptor\)/);
  assert.match(
    route,
    /document\.getElementById\("result-tab"\) \?\? document\.getElementById\("result-pane"\)/,
  );
  assert.match(route, /if \(available\(target\)\) restoreDialogFocus\(target, origin\.url\)/);
});
