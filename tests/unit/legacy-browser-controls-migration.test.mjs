import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const OTHER_RUN = "44444444-4444-4444-8444-444444444444";
const APPROVAL = "55555555-5555-4555-8555-555555555555";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905001247_legacy_browser_atomic_controls.sql",
    import.meta.url,
  ),
  "utf8",
);
async function fixture(status = "running") {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.agent_runs(id uuid PRIMARY KEY,owner_id uuid,status text,available_at timestamptz,
        cancellation_category text,lease_owner text,lease_expires_at timestamptz,cancelled_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.agent_run_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid,owner_id uuid,status text,
        lease_owner text,lease_expires_at timestamptz,completed_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.agent_run_events(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid,owner_id uuid,kind text,safe_payload jsonb);
      CREATE TABLE public.integration_action_approvals(id uuid PRIMARY KEY,owner_id uuid,status text,decided_at timestamptz);
    `);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
    await db.query(
      "INSERT INTO public.agent_runs(id,owner_id,status,lease_owner) VALUES($1,$2,$3,'old-worker'),($4,$2,'approval_needed',NULL)",
      [RUN, OWNER, status, OTHER_RUN],
    );
    await db.query(
      "INSERT INTO public.agent_run_tasks(run_id,owner_id,status,lease_owner) VALUES($1,$2,'running','old-worker')",
      [RUN, OWNER],
    );
    await db.query(
      "INSERT INTO public.integration_action_approvals(id,owner_id,status) VALUES($1,$2,'pending')",
      [APPROVAL, OWNER],
    );
    await db.exec(migration);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function bind(db, run = RUN) {
  await db.query(
    "INSERT INTO public.agent_run_approval_bindings(approval_id,run_id,owner_id) VALUES($1,$2,$3)",
    [APPROVAL, run, OWNER],
  );
}

test("retry heals a legacy cancelled run and records exactly one trusted cancellation event", async () => {
  const db = await fixture("cancelled");
  try {
    await bind(db);
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await db.query("SELECT public.control_disabled_browser_run($1,'cancel') result", [RUN]))
          .rows[0].result.idempotent,
        true,
      );
    assert.deepEqual(
      (await db.query("SELECT status,lease_owner FROM public.agent_run_tasks")).rows,
      [{ status: "cancelled", lease_owner: null }],
    );
    assert.equal(
      (await db.query("SELECT status FROM public.integration_action_approvals")).rows[0].status,
      "denied",
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.agent_run_events")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("audit insertion failure rolls back approval, run, and child transitions together", async () => {
  const db = await fixture("approval_needed");
  try {
    await bind(db);
    await db.exec("ALTER TABLE public.agent_run_events ADD CONSTRAINT reject_event CHECK(false)");
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'deny',$2)", [RUN, APPROVAL]),
      /reject_event/,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.agent_runs WHERE id=$1", [RUN])).rows[0].status,
      "approval_needed",
    );
    assert.equal(
      (await db.query("SELECT status FROM public.agent_run_tasks")).rows[0].status,
      "running",
    );
    assert.equal(
      (await db.query("SELECT status FROM public.integration_action_approvals")).rows[0].status,
      "pending",
    );
  } finally {
    await db.close();
  }
});

test("unbound or differently bound approvals cannot be denied as part of a run", async () => {
  const db = await fixture("approval_needed");
  try {
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'deny',$2)", [RUN, APPROVAL]),
      /approval_not_pending/,
    );
    await bind(db, OTHER_RUN);
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'deny',$2)", [RUN, APPROVAL]),
      /approval_not_pending/,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.integration_action_approvals")).rows[0].status,
      "pending",
    );
    await db.query("SELECT public.control_disabled_browser_run($1,'cancel')", [RUN]);
    assert.equal(
      (await db.query("SELECT status FROM public.integration_action_approvals")).rows[0].status,
      "pending",
    );
  } finally {
    await db.close();
  }
});

test("a proven prior denial can heal its run and repeated denial is idempotent", async () => {
  const db = await fixture("approval_needed");
  try {
    await bind(db);
    await db.exec("UPDATE public.integration_action_approvals SET status='denied'");
    assert.equal(
      (
        await db.query("SELECT public.control_disabled_browser_run($1,'deny',$2) result", [
          RUN,
          APPROVAL,
        ])
      ).rows[0].result.status,
      "cancelled",
    );
    assert.equal(
      (
        await db.query("SELECT public.control_disabled_browser_run($1,'deny',$2) result", [
          RUN,
          APPROVAL,
        ])
      ).rows[0].result.idempotent,
      true,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.agent_run_events")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("binding ownership, role privileges, caller identity, and terminal boundaries fail closed", async () => {
  const db = await fixture("completed");
  try {
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO public.agent_run_approval_bindings(approval_id,run_id,owner_id) VALUES($1,$2,$3)",
          [APPROVAL, RUN, OTHER],
        ),
      /foreign key/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('authenticated','public.agent_run_approval_bindings','INSERT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('service_role','public.control_disabled_browser_run(uuid,text,uuid)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'cancel')", [RUN]),
      /not_cancellable/,
    );
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'resume')", [RUN]),
      /browser_agent_unavailable/,
    );
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'cancel')", [RUN]),
      /not_found/,
    );
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'cancel')", [RUN]),
      /authentication_required/,
    );
  } finally {
    await db.close();
  }
});

test("pausing historical work is atomic and never resumes execution", async () => {
  const db = await fixture();
  try {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await db.query("SELECT public.control_disabled_browser_run($1,'pause') result", [RUN]))
          .rows[0].result.status,
        "paused",
      );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.agent_run_events")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT lease_owner FROM public.agent_runs WHERE id=$1", [RUN])).rows[0]
        .lease_owner,
      null,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.integration_action_approvals")).rows[0].status,
      "pending",
    );
    await assert.rejects(
      () => db.query("SELECT public.control_disabled_browser_run($1,'resume')", [RUN]),
      /browser_agent_unavailable/,
    );
  } finally {
    await db.close();
  }
});
