import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const paths = ["infra/azure/production/main.bicep", "infra/azure/staging/main.bicep"];

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `${label}: expected source was not found`);
  assert.equal(source.indexOf(before, index + before.length), -1, `${label}: source was not unique`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

for (const path of paths) {
  let source = readFileSync(path, "utf8");
  if (!source.includes("param scheduledTasksEnabled bool = false")) {
    source = replaceOnce(
      source,
      `@description('Maximum pending or failed delivery backlog accepted as healthy.')
@minValue(0)
@maxValue(10000)
param schedulerMaxDeliveryBacklog int = 100

@description('Deploy Azure Monitor scheduler failure and missing-success alerts.')`,
      `@description('Maximum pending or failed delivery backlog accepted as healthy.')
@minValue(0)
@maxValue(10000)
param schedulerMaxDeliveryBacklog int = 100

@description('Expose Scheduled Tasks in the web UI only after schema, worker and canary verification. The runtime remains disabled unless the Job and generation are also enabled.')
param scheduledTasksEnabled bool = false

@description('Deploy Azure Monitor scheduler failure and missing-success alerts.')`,
      `${path} scheduledTasksEnabled parameter`,
    );
  }

  if (!source.includes("name: 'KOVA_SCHEDULED_TASKS_ENABLED'")) {
    source = replaceOnce(
      source,
      `  {
    name: 'KOVA_EXPECTED_SUPABASE_PROJECT_REF'
    value: expectedSupabaseProjectRef
  }`,
      `  {
    name: 'KOVA_SCHEDULED_TASKS_ENABLED'
    value: scheduledTasksEnabled && deployScheduledJob && generationEnabled ? '1' : '0'
  }
  {
    name: 'KOVA_EXPECTED_SUPABASE_PROJECT_REF'
    value: expectedSupabaseProjectRef
  }`,
      `${path} runtime scheduler activation`,
    );
  }

  assert.match(source, /param scheduledTasksEnabled bool = false/u);
  assert.match(
    source,
    /name: 'KOVA_SCHEDULED_TASKS_ENABLED'[\s\S]*?scheduledTasksEnabled && deployScheduledJob && generationEnabled \? '1' : '0'/u,
  );
  writeFileSync(path, source);
  console.log(path);
}

console.log("KOVAGPT_SCHEDULED_RUNTIME_ACTIVATION_V2_APPLIED=2");
