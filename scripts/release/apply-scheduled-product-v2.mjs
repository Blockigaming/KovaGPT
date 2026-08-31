import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const routePath = "src/routes/scheduled-tasks.tsx";
const testPath = "tests/unit/scheduled-history-retry-v2.test.mjs";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `${label}: expected source was not found`);
  assert.equal(source.indexOf(before, index + before.length), -1, `${label}: source was not unique`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchRoute() {
  let source = readFileSync(routePath, "utf8");
  if (source.includes("<ScheduledTaskHistoryPanel taskId={t.id}")) {
    assert.match(source, /retryTask\(\{ data: \{ taskId: task\.id \} \}\)/u);
    assert.match(source, /time_zone: browserTimeZone/u);
    return false;
  }

  source = replaceOnce(
    source,
    'import { AppShell } from "@/components/AppShell";\n',
    'import { AppShell } from "@/components/AppShell";\nimport { ScheduledTaskEditor } from "@/components/ScheduledTaskEditor";\nimport { ScheduledTaskHistoryPanel } from "@/components/ScheduledTaskHistoryPanel";\n',
    "scheduled route component imports",
  );

  source = replaceOnce(
    source,
    'import { AutomationBuilder, type AutomationDraft } from "@/components/AutomationBuilder";\n',
    'import { AutomationBuilder, type AutomationDraft } from "@/components/AutomationBuilder";\nimport { retryScheduledTask } from "@/lib/scheduled-task-history.functions";\n',
    "scheduled route retry import",
  );

  source = replaceOnce(
    source,
    '  const [executionAvailable, setExecutionAvailable] = useState(false);\n\n',
    '  const [executionAvailable, setExecutionAvailable] = useState(false);\n  const browserTimeZone = useMemo(\n    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",\n    [],\n  );\n\n',
    "scheduled route browser timezone",
  );

  source = replaceOnce(
    source,
    '  const remove = useServerFn(deleteScheduledTask);\n  const checkEligible = useServerFn(isScheduledTasksEligible);\n',
    '  const remove = useServerFn(deleteScheduledTask);\n  const retryTask = useServerFn(retryScheduledTask);\n  const checkEligible = useServerFn(isScheduledTasksEligible);\n',
    "scheduled route retry server function",
  );

  source = replaceOnce(
    source,
    '        data: { title: title.trim(), prompt: prompt.trim(), run_at: iso, repeat },\n',
    '        data: {\n          title: title.trim(),\n          prompt: prompt.trim(),\n          run_at: iso,\n          repeat,\n          time_zone: browserTimeZone,\n        },\n',
    "scheduled route form timezone",
  );

  source = replaceOnce(
    source,
    '      data: { title: draft.title, prompt: draft.prompt, run_at: draft.runAt, repeat: draft.repeat },\n',
    '      data: {\n        title: draft.title,\n        prompt: draft.prompt,\n        run_at: draft.runAt,\n        repeat: draft.repeat,\n        time_zone: browserTimeZone,\n      },\n',
    "scheduled route automation timezone",
  );

  source = replaceOnce(
    source,
    '      const updated = await update({ data: { id: task.id, status: "scheduled" } });\n',
    '      const updated = await retryTask({ data: { taskId: task.id } });\n',
    "scheduled route manual retry",
  );

  source = replaceOnce(
    source,
    '                        {t.last_run_at ? (\n                          <p className="mt-2 text-xs text-muted-foreground">\n                            Last run {new Date(t.last_run_at).toLocaleString()}\n                            {t.last_result ? ` · ${t.last_result}` : ""}\n                          </p>\n                        ) : null}\n',
    '                        {t.last_run_at ? (\n                          <p className="mt-2 text-xs text-muted-foreground">\n                            Last run {new Date(t.last_run_at).toLocaleString()}\n                            {t.last_result ? ` · ${t.last_result}` : ""}\n                          </p>\n                        ) : null}\n                        <ScheduledTaskHistoryPanel taskId={t.id} />\n',
    "scheduled route history panel",
  );

  source = replaceOnce(
    source,
    '                      <div className="flex items-center gap-1">\n                        {t.status === "failed" ? (\n',
    '                      <div className="flex items-center gap-1">\n                        <ScheduledTaskEditor\n                          task={t}\n                          executionAvailable={executionAvailable}\n                          onUpdated={(updated) =>\n                            setTasks((current) =>\n                              current.map((item) => (item.id === updated.id ? updated : item)),\n                            )\n                          }\n                        />\n                        {t.status === "failed" ? (\n',
    "scheduled route editor action",
  );

  const pauseButton = `                        <button
                          onClick={() => togglePause(t)}
                          disabled={t.status === "paused" && !executionAvailable}
                          className="p-2 rounded-md hover:bg-accent transition"
                          aria-label={t.status === "paused" ? "Resume" : "Pause"}
                          title={t.status === "paused" ? "Resume" : "Pause"}
                        >
                          {t.status === "paused" ? (
                            <Play className="w-4 h-4" />
                          ) : (
                            <Pause className="w-4 h-4" />
                          )}
                        </button>
`;
  const boundedPauseButton = `                        {["scheduled", "running", "paused"].includes(t.status) ? (
                          <button
                            onClick={() => togglePause(t)}
                            disabled={t.status === "paused" && !executionAvailable}
                            className="p-2 rounded-md hover:bg-accent transition"
                            aria-label={t.status === "paused" ? "Resume" : "Pause"}
                            title={t.status === "paused" ? "Resume" : "Pause"}
                          >
                            {t.status === "paused" ? (
                              <Play className="w-4 h-4" />
                            ) : (
                              <Pause className="w-4 h-4" />
                            )}
                          </button>
                        ) : null}
`;
  source = replaceOnce(source, pauseButton, boundedPauseButton, "scheduled route lifecycle controls");

  source = source.replace(
    "Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.",
    "Times are shown in {browserTimeZone}.",
  );

  writeFileSync(routePath, source);
  return true;
}

function writeTest() {
  writeFileSync(
    testPath,
    `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const retryMigration = readFileSync(
  "supabase/migrations/20260831210000_scheduled_history_retry_v2.sql",
  "utf8",
);
const mutationMigration = readFileSync(
  "supabase/migrations/20260831211500_scheduled_running_mutations_v2.sql",
  "utf8",
);
const functions = readFileSync("src/lib/scheduled-task-history.functions.ts", "utf8");
const taskFunctions = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
const route = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
const editor = readFileSync("src/components/ScheduledTaskEditor.tsx", "utf8");
const history = readFileSync("src/components/ScheduledTaskHistoryPanel.tsx", "utf8");

test("manual retry creates a new occurrence while preserving recurring cadence", () => {
  assert.match(retryMigration, /create or replace function public\\.owner_retry_scheduled_task_v2/u);
  assert.match(retryMigration, /manual_retry_of/u);
  assert.match(retryMigration, /recurrence_anchor/u);
  assert.match(retryMigration, /v_failed\\.recurrence_anchor/u);
  assert.match(retryMigration, /retry_occurrence_id = v_retry\\.id/u);
  assert.match(retryMigration, /scheduled_next_occurrence_v2\\(\\s*v_occ\\.recurrence_anchor/u);
  assert.doesNotMatch(retryMigration, /update public\\.scheduled_task_attempts[\\s\\S]*?attempt_number = 1/u);
});

test("manual retry stays owner-only paid and the UI fails closed until explicit runtime activation", () => {
  assert.match(retryMigration, /v_user_id uuid := auth\\.uid\\(\\)/u);
  assert.match(retryMigration, /scheduled_task_plan_tier_v2\\(v_user_id\\) not in \\('plus', 'pro'\\)/u);
  assert.match(retryMigration, /grant execute on function public\\.owner_retry_scheduled_task_v2\\(uuid\\)[\\s\\S]*?to authenticated/u);
  assert.match(functions, /if \\(!scheduledExecutionRuntimeAvailable\\(\\)\\)/u);
  assert.match(taskFunctions, /export const scheduledExecutionAvailable = false;/u);
  assert.match(taskFunctions, /export function scheduledExecutionRuntimeAvailable/u);
});

test("running owner mutations are explicitly canceled, lease fenced and edited tasks requeue safely", () => {
  assert.match(mutationMigration, /p_action in \\('pause', 'cancel', 'delete'\\) and status = 'running'/u);
  assert.match(mutationMigration, /v_attempt\\.lease_expires_at <= now\\(\\)/u);
  assert.match(mutationMigration, /v_task\\.state_version <> v_occ\\.task_state_version/u);
  assert.match(mutationMigration, /v_requeue :=/u);
  assert.match(mutationMigration, /status = case when v_requeue then 'scheduled' else 'paused' end/u);
  assert.match(mutationMigration, /when v_requeue then 'Superseded by an owner edit\\.'/u);
  assert.match(mutationMigration, /if v_queue_notification then/u);
});

test("history reads only owner-scoped rows for the selected occurrence set and omits provider receipts", () => {
  assert.match(functions, /eq\\("user_id", context\\.userId\\)/u);
  assert.match(functions, /eq\\("task_id", data\\.taskId\\)/u);
  assert.match(functions, /in\\("occurrence_id", occurrenceIds\\)/u);
  assert.doesNotMatch(functions, /provider_request_id|provider_receipt/u);
  assert.match(functions, /limit\\(50\\)/u);
  assert.match(functions, /limit\\(200\\)/u);
});

test("editing schedule fields replaces the normalized wall-clock rule and only mutable lifecycle states can edit", () => {
  assert.match(taskFunctions, /const scheduleChanged =/u);
  assert.match(taskFunctions, /p_replace_schedule_rule: scheduleChanged/u);
  assert.match(editor, /editableRunAt\\(task\\)/u);
  assert.match(editor, /time_zone: timeZone/u);
  assert.match(editor, /executionAvailable && \\["scheduled", "running", "paused"\\]\\.includes\\(task\\.status\\)/u);
});

test("scheduled-task page wires real edit history timezone and manual retry UI", () => {
  assert.match(route, /ScheduledTaskEditor/u);
  assert.match(route, /ScheduledTaskHistoryPanel/u);
  assert.match(route, /retryScheduledTask/u);
  assert.match(route, /retryTask\\(\\{ data: \\{ taskId: task\\.id \\} \\}\\)/u);
  assert.match(route, /time_zone: browserTimeZone/u);
  assert.match(route, /<ScheduledTaskHistoryPanel taskId=\\{t\\.id\\} \\/>/u);
  assert.match(route, /executionAvailable=\\{executionAvailable\\}/u);
  assert.doesNotMatch(route, /update\\(\\{ data: \\{ id: task\\.id, status: "scheduled" \\} \\}\\)/u);
});

test("history panel displays occurrence attempt and delivery evidence", () => {
  assert.match(history, /Execution history/u);
  assert.match(history, /occurrence\\.attempts/u);
  assert.match(history, /occurrence\\.deliveries/u);
  assert.match(history, /manual retry/u);
});
`,
  );
}

const changed = patchRoute();
writeTest();
console.log(`KOVAGPT_SCHEDULED_PRODUCT_V2_APPLIED=${changed ? 1 : 0}`);
console.log(routePath);
console.log(testPath);
