import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const production = readFileSync("infra/azure/production/main.bicep", "utf8");
const staging = readFileSync("infra/azure/staging/main.bicep", "utf8");
const taskFunctions = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
const historyFunctions = readFileSync("src/lib/scheduled-task-history.functions.ts", "utf8");

for (const [name, source] of [
  ["production", production],
  ["staging", staging],
]) {
  test(`${name} Scheduled Tasks activation defaults off and requires job plus generation`, () => {
    assert.match(source, /param scheduledTasksEnabled bool = false/u);
    assert.match(source, /name: 'KOVA_SCHEDULED_TASKS_ENABLED'/u);
    assert.match(
      source,
      /scheduledTasksEnabled && deployScheduledJob && generationEnabled \? '1' : '0'/u,
    );
  });
}

test("source default remains false while an explicit runtime environment flag can activate the same image", () => {
  assert.match(taskFunctions, /export const scheduledExecutionAvailable = false;/u);
  assert.match(taskFunctions, /export function scheduledExecutionRuntimeAvailable/u);
  assert.match(taskFunctions, /process\.env\.KOVA_SCHEDULED_TASKS_ENABLED/u);
  assert.match(taskFunctions, /runtimeValue === "1" \|\| runtimeValue === "true"/u);
  assert.match(taskFunctions, /executionAvailable: scheduledExecutionRuntimeAvailable\(\)/u);
  assert.match(taskFunctions, /if \(!scheduledExecutionRuntimeAvailable\(\)\)/u);
  assert.match(historyFunctions, /scheduledExecutionRuntimeAvailable/u);
  assert.match(historyFunctions, /if \(!scheduledExecutionRuntimeAvailable\(\)\)/u);
});
