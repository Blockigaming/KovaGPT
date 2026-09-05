import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const owner = id(1),
  other = id(2),
  key = id(3),
  limits = { request: 10, daily: 100, monthly: 1000, concurrent: 2 };
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
   create table auth.users(id uuid primary key);create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id)$$;
   revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
   create table account_deletion_fences(user_id uuid);create table banned_users(user_id uuid);create table user_preferences(user_id uuid,settings jsonb);grant select on account_deletion_fences,banned_users,user_preferences to service_role;
   insert into auth.users values('${owner}'),('${other}');`);
    for (const name of [
      "20260803143000_developer_api_profit_protection.sql",
      "20260905004111_developer_billing_runtime.sql",
      "20260905005610_developer_platform_identity.sql",
      "20260905035000_developer_private_files.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec("set role service_role");
    const manage = async (operation, input, user = owner) =>
      (
        await db.query("select manage_developer_workspace($1,$2,$3) result", [
          user,
          operation,
          input,
        ])
      ).rows[0].result;
    const account = await manage("create_account", { name: "Developer", currency: "USD" });
    await manage("issue_key", {
      accountId: account.accountId,
      projectId: account.projectId,
      keyId: key,
      name: "Server",
      digest: "a".repeat(64),
      suffix: "abcdef",
      scopes: ["chat", "files"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      limits,
    });
    const file = async (operation, input = {}, options = {}) =>
      (
        await db.query("select manage_developer_files($1,$2,$3,$4,$5) result", [
          options.owner ?? owner,
          Object.hasOwn(options, "key") ? options.key : key,
          Object.hasOwn(options, "project") ? options.project : account.projectId,
          operation,
          input,
        ])
      ).rows[0].result;
    return { db, manage, account, file };
  } catch (error) {
    await db.close();
    throw error;
  }
}
const upload = (text = "hello", digest = "b".repeat(64)) => ({
  filename: "example.txt",
  mimeType: "text/plain",
  text,
  requestDigest: digest,
});
test("private text files are immutable, scoped, secret-free in export and actually erased with Auth", async () => {
  const f = await fixture();
  try {
    const created = await f.file("create", upload());
    assert.equal(created.byte_size, 5);
    assert.equal(created.content, undefined);
    assert.equal((await f.file("get", { id: created.id })).content, "hello");
    assert.equal((await f.file("create", upload())).id, created.id);
    await assert.rejects(f.file("create", upload("changed")), /idempotency_conflict/);
    await assert.rejects(f.file("get", { id: created.id }, { owner: other }), /scope_required/);
    assert.equal(
      (await f.db.query("select has_table_privilege('service_role','auth.users','select') allowed"))
        .rows[0].allowed,
      false,
    );
    for (const role of ["anon", "authenticated"])
      for (const action of ["select", "insert", "update", "delete"])
        assert.equal(
          (
            await f.db.query("select has_table_privilege($1,'developer_files',$2) allowed", [
              role,
              action,
            ])
          ).rows[0].allowed,
          false,
        );
    await assert.rejects(
      f.db.query("update developer_files set content='changed'"),
      /permission denied/,
    );
    const exported = (await f.db.query("select * from developer_file_export_records")).rows[0];
    assert.equal(exported.content, "hello");
    assert.equal(exported.request_digest, undefined);
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal((await f.db.query("select count(*)::int n from developer_files")).rows[0].n, 0);
  } finally {
    await f.db.close();
  }
});
test("file limits count every owned developer project and idempotent retries consume no extra quota", async () => {
  const f = await fixture();
  try {
    const a = await f.manage("create_account", { name: "Second", currency: "USD" });
    // These are still real service-only INSERTs; fill near the boundary to test atomic RPC admission.
    for (let n = 0; n < 63; n++)
      await f.db.query(
        "insert into developer_files(owner_id,project_id,filename,mime_type,content,request_digest) values($1,$2,$3,$4,$5,$6)",
        [
          owner,
          n % 2 ? a.projectId : f.account.projectId,
          "file.txt",
          "text/plain",
          "x".repeat(32768),
          String(n).padStart(64, "0"),
        ],
      );
    const results = await Promise.allSettled([
      f.file("create", upload("x".repeat(32768), "c".repeat(64))),
      f.file("create", upload("x".repeat(32768), "d".repeat(64))),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(
      String(results.find((result) => result.status === "rejected").reason),
      /quota_exceeded/,
    );
    assert.equal(
      (await f.db.query("select sum(byte_size)::int n from developer_files")).rows[0].n,
      2097152,
    );
    const winning = results[0].status === "fulfilled" ? "c" : "d";
    assert.ok((await f.file("create", upload("x".repeat(32768), winning.repeat(64)))).id);
    await f.db.exec("delete from developer_files");
    for (let n = 0; n < 100; n++)
      await f.db.query(
        "insert into developer_files(owner_id,project_id,filename,mime_type,content,request_digest) values($1,$2,$3,$4,$5,$6)",
        [
          owner,
          n % 2 ? a.projectId : f.account.projectId,
          "file.txt",
          "text/plain",
          "x",
          String(n).padStart(64, "0"),
        ],
      );
    await assert.rejects(f.file("create", upload()), /quota_exceeded/);
    let count = 0;
    for (let page = 0; page < 4; page++) {
      const data = await f.file("list", { page }, { key: null, project: null });
      count += data.data.length;
      assert.equal(data.hasMore, page < 3);
    }
    assert.equal(count, 100);
  } finally {
    await f.db.close();
  }
});
test("retention cleanup works without a generation flag and account deletion fences block delayed create/read", async () => {
  const f = await fixture();
  try {
    const expired = id(10);
    await f.db.query(
      "insert into developer_files(id,owner_id,project_id,filename,mime_type,content,request_digest,created_at,expires_at) values($1,$2,$3,'old.txt','text/plain','old',$4,now()-interval '31 days',now()-interval '1 day')",
      [expired, owner, f.account.projectId, "e".repeat(64)],
    );
    assert.equal((await f.db.query("select expire_developer_files(100) n")).rows[0].n, 1);
    const current = await f.file("create", upload());
    await f.db.exec(
      `reset role;insert into account_deletion_fences values('${owner}');set role service_role`,
    );
    await assert.rejects(f.file("create", upload("new", "d".repeat(64))), /owner_unavailable/);
    await assert.rejects(f.file("get", { id: current.id }), /owner_unavailable/);
  } finally {
    await f.db.close();
  }
});
test("current project ownership, file scope and owner-only cleanup are rechecked by SQL", async () => {
  const f = await fixture();
  try {
    const current = await f.file("create", upload());
    await f.db.query("update developer_billing_keys set capabilities=array['chat'] where id=$1", [
      key,
    ]);
    await assert.rejects(f.file("get", { id: current.id }), /scope_required/);
    assert.equal((await f.file("get", { id: current.id }, { key: null })).content, "hello");
    assert.equal((await f.file("delete", { id: current.id }, { key: null })).deleted, true);
    await assert.rejects(f.file("get", { id: current.id }, { key: null }), /file_not_found/);
    for (const bad of [
      upload(""),
      upload("é".repeat(16385)),
      { ...upload(), filename: "../file.txt" },
      { ...upload(), mimeType: "text/html" },
      { ...upload(), filename: "file.json", mimeType: "application/json", text: "not json" },
    ])
      await assert.rejects(f.file("create", bad, { key: null }), /scope_required/);
  } finally {
    await f.db.close();
  }
});

test("last-mile file dispatch rejects revoked scope, deleted file and changed digest while returning the held credit", async () => {
  const f = await fixture();
  try {
    const version = id(8);
    await f.db.query("update developer_credit_accounts set available_amount=100 where id=$1", [
      f.account.accountId,
    ]);
    await f.db.query(
      "insert into api_pricing_versions(id,version,currency,minimum_request_charge,rounding_increment,allowance_configuration,public_price_configuration,status,approved_by,approved_at,effective_at,expires_at) values($1,1,'USD',1,.0001,'{}','{}','approved',$2,now(),now()-interval '1 hour',now()+interval '1 day')",
      [version, owner],
    );
    await f.manage("set_limits", { accountId: f.account.accountId, scope: "organization", limits });
    await f.manage("set_limits", {
      accountId: f.account.accountId,
      scope: "project",
      scopeId: f.account.projectId,
      limits,
    });
    const file = await f.file("create", upload());
    const quote = {
      pricingVersionId: version,
      currency: "USD",
      customerCharge: 5,
      maximumReservedCharge: 5,
      promotionalSubsidy: 0,
      estimatedUpstreamCost: 1,
      riskBufferAmount: 1,
      roundingDifference: 0,
      upstreamBreakdown: { input_tokens: 1 },
    };
    const reserve = async (name) =>
      (
        await f.db.query("select admit_developer_billing($1,$2,$3,$4,$5,$6,$7,$8,$9) result", [
          key,
          name,
          "a".repeat(64),
          "azure_openai",
          "luna",
          "chat",
          version,
          quote,
          {},
        ])
      ).rows[0].result;
    const dispatch = async (r, bindings) =>
      (
        await f.db.query("select dispatch_developer_billing_with_files($1,$2,$3) ok", [
          r.request_id,
          r.lease_token,
          bindings,
        ])
      ).rows[0].ok;
    const release = async (r) =>
      (
        await f.db.query("select finish_developer_billing($1,$2,'released','{}') ok", [
          r.request_id,
          r.lease_token,
        ])
      ).rows[0].ok;
    const bindings = [{ id: file.id, digest: file.content_digest }];
    let r = await reserve("changed:0");
    assert.equal(await dispatch(r, [{ id: file.id, digest: "0".repeat(64) }]), false);
    assert.equal(await release(r), true);
    r = await reserve("scope:0");
    await f.db.query("update developer_billing_keys set capabilities=array['chat'] where id=$1", [
      key,
    ]);
    assert.equal(await dispatch(r, bindings), false);
    assert.equal(await release(r), true);
    await f.db.query(
      "update developer_billing_keys set capabilities=array['chat','files'] where id=$1",
      [key],
    );
    r = await reserve("deleted:0");
    await f.file("delete", { id: file.id }, { key: null });
    assert.equal(await dispatch(r, bindings), false);
    assert.equal(await release(r), true);
    assert.deepEqual(
      (
        await f.db.query(
          "select available_amount::float8 a,reserved_amount::float8 r from developer_credit_accounts",
        )
      ).rows[0],
      { a: 100, r: 0 },
    );
    const current = await f.file("create", upload("new", "d".repeat(64)));
    r = await reserve("valid:0");
    assert.equal(await dispatch(r, [{ id: current.id, digest: current.content_digest }]), true);
    assert.equal(
      (
        await f.db.query("select settlement_state from developer_api_requests where id=$1", [
          r.request_id,
        ])
      ).rows[0].settlement_state,
      "dispatched",
    );
  } finally {
    await f.db.close();
  }
});
