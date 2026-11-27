import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = (n) => String(n).padStart(8, "0") + "-1111-4111-8111-111111111111";
const [owner, other, account, foreign, project, foreignProject, key, foreignKey, job] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
].map(id);
const digest = "a".repeat(64);
const group = "b".repeat(64);

async function fixture() {
  const db = new PGlite();
  try {
    // Isolated dependency fixture; this executes the actual staged queue SQL.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema kova_private;
      create table auth.users(id uuid primary key);
      create function kova_private.auth_user_exists(p_id uuid) returns boolean
        language sql security definer set search_path='' as
        $$select exists(select 1 from auth.users where id=p_id)$$;
      revoke all on function kova_private.auth_user_exists(uuid) from public;
      grant usage on schema auth,kova_private to service_role;
      grant execute on function kova_private.auth_user_exists(uuid) to service_role;
      create table account_deletion_fences(user_id uuid);
      create table banned_users(user_id uuid);
      create table user_preferences(user_id uuid,settings jsonb);
      create table developer_credit_accounts(id uuid primary key,currency text,suspended_at timestamptz);
      create table developer_account_owners(account_id uuid primary key,owner_id uuid);
      create table developer_projects(id uuid primary key,account_id uuid);
      create table developer_billing_keys(id uuid primary key,account_id uuid,project_id uuid,
        enabled boolean,revoked_at timestamptz,expires_at timestamptz,capabilities text[]);
      create table developer_api_requests(id uuid primary key,api_key_id uuid,project_id uuid,
        request_group text,settlement_state text,final_customer_charge numeric,created_at timestamptz);
      grant select on account_deletion_fences,banned_users,user_preferences,developer_credit_accounts,
        developer_account_owners,developer_projects,developer_billing_keys,developer_api_requests to service_role;
      insert into auth.users values('${owner}'),('${other}');
      insert into developer_credit_accounts values('${account}','USD',null),('${foreign}','USD',null);
      insert into developer_account_owners values('${account}','${owner}'),('${foreign}','${other}');
      insert into developer_projects values('${project}','${account}'),('${foreignProject}','${foreign}');
      insert into developer_billing_keys values
        ('${key}','${account}','${project}',true,null,now()+interval '1 day',array['chat']),
        ('${foreignKey}','${foreign}','${foreignProject}',true,null,now()+interval '1 day',array['chat']);
    `);
    await db.exec(await readFile("supabase/pending/developer_batches_v1.sql", "utf8"));
    await db.exec("set role service_role");
    const manage = async (operation, input, who = owner, apiKey = key, target = project) =>
      (
        await db.query("select manage_developer_batches_v1($1,$2,$3,$4,$5) result", [
          who,
          apiKey,
          target,
          operation,
          input,
        ])
      ).rows[0].result;
    const claim = async (allow = true) =>
      (await db.query("select claim_developer_batch_v1(false,$1) result", [allow])).rows[0].result;
    return { db, manage, claim };
  } catch (error) {
    await db.close();
    throw error;
  }
}

const create = () => ({
  id: job,
  resource_kind: "response",
  currency: "USD",
  maximum_ticks: 1000,
  request_digest: digest,
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  items: [
    {
      id: job,
      operation_kind: "responses",
      input: { model: "kova-fast", input: "Example", max_output_tokens: 20 },
      authorization: "signed-fixture",
      maximum_ticks: 1000,
      request_group: group,
    },
  ],
});
const replay = { id: job, resource_kind: "response", request_digest: digest };

test("response job replay is read-only, exact-match and isolated from other owners and kinds", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.manage("replay", replay), { found: false });
    const initial = await f.manage("create", create());
    const same = await f.manage("replay", replay);
    assert.equal(same.found, true);
    assert.deepEqual(same.batch, initial);
    assert.equal(same.batch.request_digest, undefined);
    assert.equal(same.batch.owner_id, undefined);
    await assert.rejects(
      f.manage("replay", { ...replay, request_digest: "c".repeat(64) }),
      /batch_conflict/,
    );
    await assert.rejects(
      f.manage("replay", { ...replay, resource_kind: "batch" }),
      /batch_not_found/,
    );
    await assert.rejects(f.manage("replay", replay, other, key, project), /scope_required/);
    assert.deepEqual(
      await f.manage("replay", replay, other, foreignKey, foreignProject),
      { found: false },
    );
    assert.equal(
      (await f.db.query("select count(*)::int n from developer_batch_items_v1")).rows[0].n,
      1,
    );
    assert.equal(await f.claim(false), null);
    const list = await f.manage("list", { resource_kind: "response" });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].status, "queued");
    assert.equal(list.data[0].input, undefined);
    await f.manage("cancel", { id: job, resource_kind: "response" });
    assert.equal(await f.claim(), null);
    const canceled = await f.manage("get_item", {
      id: job,
      item_id: job,
      resource_kind: "response",
    });
    assert.equal(canceled.state, "canceled");
    assert.equal(canceled.authorization, undefined);
    assert.equal(canceled.lease_token, undefined);
  } finally {
    await f.db.close();
  }
});

test("claimed response output is completed only with a matching settled accounting record", async () => {
  const f = await fixture();
  try {
    await f.manage("create", create());
    const claim = await f.claim();
    assert.equal(claim.item.id, job);
    assert.equal(await f.claim(), null);
    await f.db.exec("reset role");
    await f.db.query(
      "insert into developer_api_requests values($1,$2,$3,$4,'settled',1,now())",
      [id(10), key, project, group],
    );
    await f.db.exec("set role service_role");
    const finish = async (lease) =>
      (
        await f.db.query("select finish_developer_batch_v1($1,$2,$3,$4,$5) ok", [
          project,
          job,
          job,
          lease,
          { text: "Example result" },
        ])
      ).rows[0].ok;
    assert.equal(await finish(id(11)), false);
    assert.equal(await finish(claim.item.lease_token), true);
    assert.equal(await finish(claim.item.lease_token), false);
    const result = await f.manage("get_item", {
      id: job,
      item_id: job,
      resource_kind: "response",
    });
    assert.equal(result.state, "completed");
    assert.equal(result.settlement_state, "settled");
    assert.deepEqual(result.output, { text: "Example result" });
    assert.equal(result.authorization, undefined);
  } finally {
    await f.db.close();
  }
});

test("uncertain jobs do not retain or return an unsettled result", async () => {
  const f = await fixture();
  try {
    await f.manage("create", create());
    const claim = await f.claim();
    await f.db.query("select finish_developer_batch_v1($1,$2,$3,$4,$5)", [
      project,
      job,
      job,
      claim.item.lease_token,
      { text: "Not settled" },
    ]);
    const result = await f.manage("get_item", {
      id: job,
      item_id: job,
      resource_kind: "response",
    });
    assert.equal(result.state, "uncertain");
    assert.equal(result.output, null);
    assert.equal(
      (await f.db.query("select output from developer_batch_items_v1")).rows[0].output,
      null,
    );
  } finally {
    await f.db.close();
  }
});
