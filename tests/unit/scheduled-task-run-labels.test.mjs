import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../../src/lib/scheduled-task-run-labels.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { taskRunStatusLabel, taskRunDeliveryLabel, taskRunFailureLabel } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("run history names each contracted execution status without changing its meaning", () => {
  for (const [value, expected] of Object.entries({
    scheduled: "Scheduled",
    running: "Running",
    complete: "Completed",
    failed: "Failed",
    canceled: "Canceled",
    skipped_duplicate: "Duplicate run skipped",
  }))
    assert.equal(taskRunStatusLabel(value), expected);
});

test("notification status stays distinct from execution success", () => {
  for (const [value, expected] of Object.entries({
    pending: "Notification pending",
    sent: "Notification sent",
    failed: "Notification failed",
    not_configured: "Notification not configured",
  }))
    assert.equal(taskRunDeliveryLabel(value), expected);
  assert.equal(taskRunStatusLabel("complete"), "Completed");
  assert.equal(taskRunDeliveryLabel("failed"), "Notification failed");
});

test("failure labels describe the cause and eligibility without promising another run", () => {
  for (const [value, expected] of Object.entries({
    temporary: "Temporary failure",
    permanent: "Permanent failure",
    authorization: "Authorization required",
    timeout: "Timed out",
  })) {
    assert.equal(taskRunFailureLabel(value, false), expected);
    assert.equal(taskRunFailureLabel(value, true), `${expected} · Eligible for retry`);
  }
});

test("unknown future values remain visible and missing values are explicit", () => {
  for (const [format, context] of [
    [taskRunStatusLabel, "Run status"],
    [taskRunDeliveryLabel, "Notification status"],
    [taskRunFailureLabel, "Failure type"],
  ]) {
    for (const value of ["future_state", "toString", "__proto__"])
      assert.equal(format(value), `${context}: ${value}`);
    for (const value of [undefined, null, ""]) assert.equal(format(value), `${context} unknown`);
  }
});

test("the history renderer uses the labels while retaining summary and retry fields", () => {
  const editor = readFileSync(
    new URL("../../src/components/ScheduledTaskEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(editor, /taskRunStatusLabel\(run\.status\)/);
  assert.match(editor, /taskRunDeliveryLabel\(run\.delivery_status\)/);
  assert.match(editor, /taskRunFailureLabel\(run\.failure_type, run\.retry_eligible\)/);
  assert.match(editor, /String\(run\.result_summary \?\? ""\)/);
});
