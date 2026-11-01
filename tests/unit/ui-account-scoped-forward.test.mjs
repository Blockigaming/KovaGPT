import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Reuse the synthetic legacy task schema from its boundary suite. No customer
// records, sessions, keys or provider requests participate in this rehearsal.
const source = ts.createSourceFile(
  "fixture.mjs",
  readFileSync("tests/unit/scheduled-tasks-foundation.test.mjs", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let setup;
function visit(n) {
  if (
    !setup &&
    ts.isCallExpression(n) &&
    n.expression.getText(source) === "db.exec" &&
    n.arguments[0]?.kind === ts.SyntaxKind.TemplateExpression
  )
    setup = n.arguments[0].getText(source);
  ts.forEachChild(n, visit);
}
visit(source);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
test("exact scoped forward bundle installs atomically, leaves execution disabled and refuses a changed live baseline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kova-scoped-forward-"));
  const path = join(dir, "forward.sql");
  const plan = JSON.parse(
    execFileSync(process.execPath, ["scripts/release/prepare-ui-account-forward.mjs", path], {
      encoding: "utf8",
    }),
  );
  const db = new PGlite();
  try {
    assert.equal(plan.productionWrites, 0);
    assert.equal(plan.sources.length, 6);
    assert.ok(setup);
    await db.exec(new Function("owner", "other", `return (${setup});`)(owner, other));
    await db.exec(`create schema kova_auth_guard;
   create function kova_auth_guard.session_is_active() returns boolean language sql stable as $$select true$$;
   grant usage on schema kova_auth_guard to authenticated,service_role;
   create table public.daily_usage(user_id uuid,usage_date date,chats integer not null default 0,images integer not null default 0,uploads integer not null default 0,updated_at timestamptz,primary key(user_id,usage_date));
   create table public.chat_memories(id uuid primary key default gen_random_uuid(),user_id uuid,chat_id text,title text,summary text,message_count integer,updated_at timestamptz,unique(user_id,chat_id));
   create table public.chat_history_records(owner_id uuid,id text,revision bigint,deleted_at timestamptz);
   grant all on public.daily_usage,public.chat_memories,public.chat_history_records to service_role;`);
    for (const name of [
      "20260905001736_private_auth_identity_helpers.sql",
      "20260627210732_128bcdac-00eb-458b-8801-2a1bdb24915f.sql",
      "20260722123000_connectors_tasks_sharing_settings_audit.sql",
      "20260822143000_day14_scheduled_execution.sql",
      "20260823113000_day14_atomic_settlement.sql",
    ])
      await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
    const sql = readFileSync(path, "utf8");
    await db.exec(sql);
    assert.equal(
      (await db.query("select enabled from scheduled_task_runtime")).rows[0].enabled,
      false,
    );
    assert.equal((await db.query("select count(*)::integer n from scheduled_tasks")).rows[0].n, 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from pg_policies where policyname='kova_owned_session_guard' and tablename in('chat_context_summaries','scheduled_task_copy_offers','scheduled_task_connection_grants','scheduled_task_events')",
        )
      ).rows[0].n,
      4,
    );
    await assert.rejects(db.exec(sql), /scoped_live_baseline_changed/);
    await db.exec("rollback");
    assert.equal(
      (await db.query("select enabled from scheduled_task_runtime")).rows[0].enabled,
      false,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.try_consume_daily_message($1,false,50,10)", [owner]),
      /permission denied/,
    );
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
