import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
const route = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260905005111_scheduled_tasks_activation_foundation.sql",
  "utf8",
);

test("terminal scheduled-task states cannot be overwritten by pause or resume", () => {
  const update = server.slice(
    server.indexOf("export const updateScheduledTask"),
    server.indexOf("export const deleteScheduledTask"),
  );
  assert.doesNotMatch(update, /\.select\("status"\)[\s\S]{0,200}\.update\(patch\)/);
  assert.match(update, /assertTaskPrincipal\(data, context\.userId\)/);
  assert.match(update, /await mutate\(context\.userId, data\.action/);
  assert.match(server, /\.rpc\("mutate_scheduled_task", \{\s*p_user_id: userId,/);
  assert.match(server, /p_expected_revision: input\.expectedRevision/);
  assert.match(migration, /where id=p_task_id and user_id=p_user_id for update/);
  assert.match(
    migration,
    /if task\.revision<>p_expected_revision then raise exception 'task_revision_conflict'/,
  );
  assert.match(migration, /p_action='resume' and task\.status<>'paused'/);
  assert.match(
    migration,
    /p_action='pause' then\s*if task\.status not in\('scheduled','running','paused'\) then raise exception 'task_transition_conflict'/,
  );

  assert.match(route, /\["scheduled", "running", "paused"\]\.includes\(t\.status\)/);
  assert.match(route, /No historical task records are available for this account/);
});
