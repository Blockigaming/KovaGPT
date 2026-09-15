import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260904230329_production_privilege_lineage_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const lockedTables = [
  "agent_workers",
  "api_emergency_controls",
  "api_pricing_versions",
  "credit_purchases",
  "developer_api_requests",
  "developer_credit_accounts",
  "developer_credit_ledger",
  "diagnostic_rate_limits",
  "github_oauth_states",
  "github_webhook_deliveries",
  "integration_oauth_states",
  "integration_providers",
  "integration_webhook_subscriptions",
  "integration_workspace_policies",
  "kova_schema_contract",
  "upstream_price_registry",
];
const connectorPrivileges = {
  connected_account_audit_log: ["SELECT"],
  connected_accounts: ["SELECT", "DELETE"],
  google_oauth_tokens: [],
  integration_linked_accounts: ["SELECT"],
  integration_sync_jobs: ["SELECT"],
  integration_consents: ["SELECT"],
  integration_action_approvals: ["SELECT", "UPDATE"],
  integration_audit_events: ["SELECT"],
  integration_deletion_requests: ["SELECT"],
  github_accounts: ["SELECT"],
  github_installations: ["SELECT"],
  github_repositories: ["SELECT"],
  github_repository_branches: ["SELECT"],
  github_sync_records: ["SELECT"],
  github_tool_audit: ["SELECT"],
  github_webhooks: ["SELECT"],
  github_coding_selections: ["SELECT", "INSERT", "UPDATE", "DELETE"],
};
const triggerNames = [
  "enforce_family_member_cap",
  "enforce_supported_agent_job_kind",
  "set_feedback_submission_updated_at",
  "validate_agent_dependency_edge",
  "set_deep_research_updated_at",
  "prevent_financial_entry_mutation",
  "touch_updated_at",
];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema kova_private;
    grant usage on schema auth, kova_private to authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table public.family_groups (id uuid primary key, owner_id uuid not null);
    create table public.family_members (group_id uuid, user_id uuid);
    create table public.subscriptions (
      user_id uuid, price_id text, status text, current_period_end timestamptz,
      created_at timestamptz default now()
    );
    alter table public.subscriptions enable row level security;
    grant select on public.subscriptions to authenticated, service_role;
    create policy subscriptions_owner on public.subscriptions for select to authenticated
      using (user_id = (select auth.uid()));
    create function kova_private.family_owner_of(_user_id uuid) returns uuid
      language sql stable security definer set search_path=public as $$
        select g.owner_id from public.family_members m
        join public.family_groups g on g.id=m.group_id
        where m.user_id=_user_id limit 1
      $$;
    create function public.family_owner_of(_user_id uuid) returns uuid
      language sql stable security invoker set search_path=pg_catalog as
      $$ select kova_private.family_owner_of(_user_id) $$;
    grant execute on function public.family_owner_of(uuid) to authenticated, service_role;
    insert into public.family_groups values ('${owner}', '${owner}');
    insert into public.family_members values ('${owner}', '${owner}');
    insert into public.subscriptions(user_id,price_id,status,current_period_end)
      values ('${owner}','plus_monthly','active',now()+interval '1 month');
    alter default privileges for role postgres in schema public
      grant all on tables to public, anon, authenticated;
    alter default privileges for role postgres in schema public
      grant all on sequences to public, anon, authenticated;
    alter default privileges for role postgres in schema public
      grant execute on functions to anon, authenticated;
  `);
  for (const name of [...lockedTables, ...Object.keys(connectorPrivileges)]) {
    await db.exec(`create table public.${name} (id integer);`);
  }
  for (const name of triggerNames) {
    await db.exec(`create function public.${name}() returns trigger language plpgsql
      security definer as $$ begin return new; end $$;`);
  }
  return db;
}

async function identify(db, role, id) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
}

test("forward reconciliation prevents family and billing probes through both callable layers", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await identify(db, "authenticated", owner);
    assert.equal(
      (await db.query("select public.family_owner_of($1) result", [owner])).rows[0].result,
      owner,
    );
    assert.equal(
      (await db.query("select public.user_plan_tier($1) result", [owner])).rows[0].result,
      "plus",
    );
    await identify(db, "authenticated", other);
    for (const name of [
      "public.family_owner_of",
      "kova_private.family_owner_of",
      "public.user_plan_tier",
    ]) {
      await assert.rejects(db.query(`select ${name}($1)`, [owner]), { code: "42501" });
      await assert.rejects(db.query(`select ${name}(null)`), { code: "42501" });
    }
    await identify(db, "service_role", null);
    assert.equal(
      (await db.query("select public.family_owner_of($1) result", [owner])).rows[0].result,
      owner,
    );
    assert.equal(
      (await db.query("select public.user_plan_tier($1) result", [owner])).rows[0].result,
      "plus",
    );
  } finally {
    await db.close();
  }
});

test("all sixteen server tables and seventeen connector grants match the reviewed privilege matrix", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(migration);
    for (const table of [...lockedTables, ...Object.keys(connectorPrivileges)]) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN",
      ]) {
        const row = (
          await db.query(
            `select
          has_table_privilege('authenticated',$1,$2) authenticated,
          has_table_privilege('anon',$1,$2) anon,
          has_table_privilege('service_role',$1,$2) service`,
            [`public.${table}`, privilege],
          )
        ).rows[0];
        assert.equal(
          row.authenticated,
          (connectorPrivileges[table] ?? []).includes(privilege),
          `${table}: ${privilege}`,
        );
        assert.equal(row.anon, false, `${table}: anon ${privilege}`);
        assert.equal(row.service, true, `${table}: service ${privilege}`);
      }
    }
    const policies = await db.query(
      `select count(*)::integer total from pg_policies
      where tablename=any($1) and permissive='RESTRICTIVE' and qual='false' and with_check='false'`,
      [lockedTables],
    );
    assert.equal(policies.rows[0].total, lockedTables.length);
    await db.exec(`grant select on public.agent_workers to authenticated;
      create policy accidental_allow on public.agent_workers for select to authenticated using(true);
      insert into public.agent_workers values(1);`);
    await identify(db, "authenticated", owner);
    assert.deepEqual((await db.query("select * from public.agent_workers")).rows, []);
  } finally {
    await db.close();
  }
});

test("future objects deny inherited browser privileges and trigger routines cannot be called directly", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(`create table public.future_table(id integer);
      create sequence public.future_sequence;
      create function public.future_function() returns integer language sql as $$ select 1 $$;`);
    const row = (
      await db.query(`select
      has_table_privilege('authenticated','public.future_table','SELECT') table_select,
      has_sequence_privilege('authenticated','public.future_sequence','UPDATE') sequence_update,
      has_function_privilege('authenticated','public.future_function()','EXECUTE') function_authenticated,
      has_function_privilege('anon','public.future_function()','EXECUTE') function_anon,
      has_function_privilege('service_role','public.future_function()','EXECUTE') function_service`)
    ).rows[0];
    assert.deepEqual(row, {
      table_select: false,
      sequence_update: false,
      function_authenticated: false,
      function_anon: false,
      function_service: true,
    });
    for (const name of triggerNames) {
      const result = (
        await db.query(
          `select
        has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
        has_function_privilege('anon',$1,'EXECUTE') anon,
        has_function_privilege('service_role',$1,'EXECUTE') service`,
          [`public.${name}()`],
        )
      ).rows[0];
      assert.deepEqual(result, { authenticated: false, anon: false, service: true });
    }
  } finally {
    await db.close();
  }
});
