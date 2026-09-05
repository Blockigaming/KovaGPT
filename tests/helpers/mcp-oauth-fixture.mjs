import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { mcpClientRegistration } from "../../src/lib/pricing/mcp-oauth-policy.mjs";
export const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export const owner = id(1),
  other = id(2),
  client = id(3),
  request = id(4),
  grant = id(5),
  key = id(6),
  code = id(7);
export const resource = "https://kova.example/mcp",
  redirect = "https://client.example/callback?keep=a%20b";
export const limits = { request: 1, daily: 10, monthly: 100, concurrent: 2 };
export const hash = "a".repeat(64),
  digest = "b".repeat(64),
  challenge = "c".repeat(43);
export async function rpc(db, name, args) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) result`,
      args,
    )
  ).rows[0].result;
}
export async function fixture({ refresh = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role auth_admin;create schema auth;create schema kova_private;
 create table auth.users(id uuid primary key,deleted_at timestamptz,email_confirmed_at timestamptz,is_anonymous boolean,banned_until timestamptz);
 create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id and deleted_at is null)$$;
 revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
 grant usage on schema auth to auth_admin;grant select,delete on auth.users to auth_admin;
 create table account_deletion_fences(user_id uuid);create table banned_users(user_id uuid);create table user_preferences(user_id uuid,settings jsonb);grant select on account_deletion_fences,banned_users,user_preferences to service_role;
 insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${other}',now());`);
    for (const migration of [
      "20260803143000_developer_api_profit_protection.sql",
      "20260905004111_developer_billing_runtime.sql",
      "20260905005610_developer_platform_identity.sql",
      "20260905011420_developer_owner_export.sql",
      "20260905032714_developer_mcp_oauth.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    await db.exec("set role service_role");
    const account = await rpc(db, "manage_developer_workspace", [
      owner,
      "create_account",
      { name: "Developer", currency: "USD" },
    ]);
    for (const scope of ["organization", "project"])
      await rpc(db, "manage_developer_workspace", [
        owner,
        "set_limits",
        {
          accountId: account.accountId,
          scope,
          scopeId: scope === "project" ? account.projectId : null,
          limits,
        },
      ]);
    const metadata = mcpClientRegistration({
      client_name: "External client",
      redirect_uris: [redirect],
      grant_types: refresh ? ["authorization_code", "refresh_token"] : ["authorization_code"],
    });
    await rpc(db, "register_mcp_oauth_client", [client, owner, metadata]);
    const input = {
      clientId: client,
      redirectUri: redirect,
      scopes: ["chat", "files"],
      state: "request-state",
      challenge,
      resource,
    };
    await rpc(db, "begin_mcp_oauth_request", [request, client, input, hash]);
    const details = await rpc(db, "read_mcp_oauth_consent", [owner, request]);
    return { db, account, metadata, input, details };
  } catch (error) {
    await db.close();
    throw error;
  }
}
export async function approve(f, extra = {}) {
  const value = {
    owner,
    request,
    hash,
    approve: true,
    project: f.account.projectId,
    scopes: ["chat", "files"],
    limits,
    reviewHash: hash,
    grant,
    key,
    keyDigest: digest,
    code,
    codeDigest: digest,
    ...extra,
  };
  return rpc(f.db, "decide_mcp_oauth_consent", Object.values(value));
}
export async function exchange(db, extra = {}) {
  const value = {
    kind: "code",
    token: code,
    digest,
    client,
    resource,
    redirect,
    challenge,
    scopes: null,
    access: id(20),
    accessDigest: hash,
    refresh: id(21),
    refreshDigest: hash,
    ...extra,
  };
  return rpc(db, "exchange_mcp_oauth_token", Object.values(value));
}
export async function validate(db, token = id(20), value = hash, target = resource) {
  return rpc(db, "validate_mcp_oauth_access", [token, value, target]);
}
