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
      "20260905011420_developer_owner_export.sql",
      "20261127205018_developer_workspace_v2.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec(`create table public.integration_linked_accounts(id uuid primary key,owner_id uuid references auth.users(id),workspace_id uuid,provider_id text,provider_account_id text,account_label text,status text,granted_scopes text[],access_token_ciphertext text,token_expires_at timestamptz,deleted_at timestamptz);
      grant select,insert,update,delete on public.integration_linked_accounts to service_role;
      insert into public.integration_linked_accounts values('${id(10)}','${owner}',null,'custom-mcp','reviewed-test','Test','connected',array['mcp:reviewed-tool:read'],'encrypted-ciphertext',null,null),('${id(11)}','${other}',null,'custom-mcp','reviewed-test','Foreign','connected',array['mcp:reviewed-tool:read'],'foreign-ciphertext',null,null);`);
    await db.exec(
      await readFile("supabase/migrations/20261128105700_developer_mcp_connections_v1.sql", "utf8"),
    );
    await db.exec("set role service_role");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function manage(db, operation, input, user = owner) {
  return (
    await db.query("select manage_developer_workspace($1,$2,$3) result", [user, operation, input])
  ).rows[0].result;
}
async function account(db) {
  return manage(db, "create_account", { name: "API workspace", currency: "USD" });
}
function keyInput(a, extra = {}) {
  return {
    accountId: a.accountId,
    projectId: a.projectId,
    keyId: key,
    name: "Server",
    digest: "a".repeat(64),
    suffix: "abc123",
    scopes: ["chat"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    limits,
    ...extra,
  };
}

test("MCP owner grant, discovery, authorization, rotation and revocation remain isolated", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a, { scopes: ["mcp_read"] }));
    const rpc = async (op, input = {}, apiKey = null, user = owner, project = a.projectId) =>
      (
        await db.query("select manage_developer_mcp_connections_v1($1,$2,$3,$4,$5) result", [
          user,
          project,
          apiKey,
          op,
          input,
        ])
      ).rows[0].result;
    const grant = {
      id: id(12),
      keyId: key,
      linkedAccountId: id(10),
      serverId: "reviewed-test",
      tool: "search",
      binding: "a".repeat(43),
      approved: true,
    };
    const lookup = { id: grant.id, tool: grant.tool };
    const list = await rpc("owner_list");
    assert.equal(list.accounts.length, 1);
    assert.equal(list.keys.length, 1);
    assert.doesNotMatch(JSON.stringify(list), /ciphertext|secret_digest/);
    await assert.rejects(rpc("grant", { ...grant, approved: false }), /invalid/);
    await assert.rejects(rpc("grant", { ...grant, linkedAccountId: id(11) }), /not_found/);
    await assert.rejects(rpc("grant", grant, null, other), /scope_required/);
    await rpc("grant", grant);
    const rows = await rpc("list", {}, key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, grant.id);
    assert.doesNotMatch(JSON.stringify(rows), /ciphertext|credential_digest|key_digest/);
    assert.equal((await rpc("authorize", lookup, key)).credential, "encrypted-ciphertext");
    await assert.rejects(rpc("authorize", { ...lookup, tool: "write" }, key), /not_found/);
    await assert.rejects(rpc("authorize", lookup, key, other), /scope_required/);
    await assert.rejects(rpc("authorize", lookup, key, owner, id(19)), /scope_required/);
    for (const sql of [
      "update integration_linked_accounts set access_token_ciphertext='changed'",
      "update integration_linked_accounts set status='revoked'",
      "update integration_linked_accounts set token_expires_at=now()-interval '1 hour'",
      "update developer_billing_keys set secret_digest='" + "b".repeat(64) + "'",
    ]) {
      await db.exec(sql);
      await assert.rejects(rpc("authorize", lookup, key), /not_found/);
      assert.deepEqual(await rpc("list", {}, key), []);
      await db.exec(
        "update integration_linked_accounts set access_token_ciphertext='encrypted-ciphertext',status='connected',token_expires_at=null;update developer_billing_keys set secret_digest='" +
          "a".repeat(64) +
          "'",
      );
    }
    for (let n = 20; n < 29; n++) await rpc("grant", { ...grant, id: id(n) });
    await assert.rejects(rpc("grant", { ...grant, id: id(30) }), /quota_exceeded/);
    await rpc("revoke", { id: grant.id });
    await rpc("revoke", { id: grant.id });
    await assert.rejects(rpc("authorize", lookup, key), /not_found/);
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'manage_developer_mcp_connections_v1(uuid,uuid,uuid,text,jsonb)','execute') ok",
            [role],
          )
        ).rows[0].ok,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege($1,'developer_mcp_connections_v1','select') ok",
            [role],
          )
        ).rows[0].ok,
        false,
      );
    }
  } finally {
    await db.close();
  }
});
