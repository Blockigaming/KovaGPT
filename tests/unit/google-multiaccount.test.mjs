import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createGoogleAccountRuntime } from "../../src/lib/google-account-runtime.server.mjs";
import {
  parseGoogleBinding,
  googleConnectionHealth,
  hasGoogleCapability,
} from "../../src/lib/google-account-policy.mjs";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905005417_google_multiaccount_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const email = (sub) => `${sub}@example.test`;
const scopes =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema kova_private to service_role;
 create table auth.users(id uuid primary key,deleted_at timestamptz);insert into auth.users(id) values('${owner}'),('${other}');
 create function kova_private.auth_user_exists(id uuid)returns boolean language sql security definer as $$select exists(select 1 from auth.users where users.id=$1 and deleted_at is null)$$;revoke all on function kova_private.auth_user_exists(uuid) from public;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
 create table public.account_deletion_fences(user_id uuid primary key);grant all on public.account_deletion_fences to service_role;
 create table public.google_oauth_tokens(user_id uuid primary key references auth.users(id)on delete cascade,google_sub text,email text,access_token text not null,refresh_token text,expires_at timestamptz not null,scopes text not null default '',created_at timestamptz default now(),updated_at timestamptz default now());alter table public.google_oauth_tokens enable row level security;`);
  await db.exec(migration);
  const vault = async (user, operation, data = {}) => {
    await db.exec("set role service_role");
    try {
      return (
        await db.query("select public.google_connection_rpc($1,$2,$3::jsonb) as result", [
          user,
          operation,
          JSON.stringify(data),
        ])
      ).rows[0].result;
    } finally {
      await db.exec("reset role");
    }
  };
  const connect = async (user, sub, target) => {
    const attemptId = crypto.randomUUID();
    await vault(user, "begin_oauth", { attemptId, connectionId: target });
    return vault(user, "complete_oauth", {
      attemptId,
      googleSub: sub,
      email: email(sub),
      accessToken: `sealed:access-${sub}`,
      refreshToken: `sealed:refresh-${sub}`,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      scopes,
    });
  };
  return { db, vault, connect };
}
const binding = (row) => ({
  connectionId: row.id,
  grantId: row.grant_id,
  expectedGoogleSub: row.google_sub,
  capability: "gmail.read",
});
function runtime(vault, fetchImpl) {
  return createGoogleAccountRuntime({
    vault,
    encrypt: async (value) => `sealed:${value}`,
    decrypt: async (value) => value.replace(/^sealed:/u, ""),
    clientId: "client",
    clientSecret: "secret",
    fetchImpl,
  });
}
const userinfo = (sub) => Response.json({ sub, email: email(sub), email_verified: true });

test("connections retain independent ownership, selection CAS and server-only credential privileges", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A"),
      b = await connect(owner, "B"),
      foreign = await connect(other, "A");
    assert.notEqual(a.id, foreign.id);
    let list = await vault(owner, "list");
    assert.equal(list.accounts.length, 2);
    assert.equal(list.selectedConnectionId, a.id);
    assert.ok(
      list.accounts.every(
        (row) => !Object.hasOwn(row, "access_token") && !Object.hasOwn(row, "refresh_token"),
      ),
    );
    await assert.rejects(vault(other, "get", { connectionId: a.id }), /connection_changed/);
    await vault(owner, "select", { connectionId: b.id, expectedRevision: list.selectionRevision });
    await assert.rejects(
      vault(owner, "select", { connectionId: a.id, expectedRevision: list.selectionRevision }),
      /selection_conflict/,
    );
    assert.equal((await vault(owner, "get")).id, b.id);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select access_token from google_oauth_tokens"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.google_connection_rpc($1,'list')", [owner]),
      /permission denied/,
    );
    await db.exec("reset role");
    const exported = (await db.query("select * from google_connection_export_rows")).rows;
    assert.ok(
      exported.every(
        (row) => !Object.hasOwn(row, "access_token") && !Object.hasOwn(row, "grant_id"),
      ),
    );
  } finally {
    await db.close();
  }
});
test("disconnect clears credentials, closes old consent attempts, and rejects old grant generations", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A"),
      b = await connect(owner, "B");
    const row = await vault(owner, "get", { connectionId: a.id });
    const attemptId = crypto.randomUUID();
    await vault(owner, "begin_oauth", { attemptId, connectionId: a.id });
    const revoked = await vault(owner, "disconnect", { connectionId: a.id, expectedRevision: 1 });
    assert.equal(revoked.length, 1);
    assert.equal((await vault(owner, "list")).selectedConnectionId, null);
    await assert.rejects(vault(owner, "get", { connectionId: a.id }), /connection_changed/);
    assert.equal((await vault(owner, "get", { connectionId: b.id })).id, b.id);
    const purged = (
      await db.query("select access_token,refresh_token from google_oauth_tokens where id=$1", [
        a.id,
      ])
    ).rows[0];
    assert.deepEqual(purged, { access_token: "", refresh_token: null });
    await assert.rejects(vault(owner, "complete_oauth", { attemptId }), /attempt_closed/);
    const next = await connect(owner, "A", a.id);
    assert.equal(next.id, a.id);
    assert.notEqual(next.grantId, row.grant_id);
    await assert.rejects(
      vault(owner, "get", { connectionId: a.id, grantId: row.grant_id }),
      /connection_changed/,
    );
  } finally {
    await db.close();
  }
});
test("a delayed disconnect cannot revoke a newly authorized generation", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    const before = await vault(owner, "get", { connectionId: a.id });
    await connect(owner, "A", a.id);
    await assert.rejects(
      vault(owner, "disconnect", {
        connectionId: a.id,
        expectedRevision: before.credential_revision,
      }),
      /connection_changed/,
    );
    const after = await vault(owner, "get", { connectionId: a.id });
    assert.notEqual(after.grant_id, before.grant_id);
    assert.equal(after.revoked_at, null);
  } finally {
    await db.close();
  }
});

test("a completed consent invalidates parallel stale callback windows", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const id = crypto.randomUUID();
    await vault(owner, "begin_oauth", { attemptId: id });
    const a = await connect(owner, "A");
    await assert.rejects(
      vault(owner, "complete_oauth", {
        attemptId: id,
        googleSub: "A",
        email: email("A"),
        accessToken: "sealed:older",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        scopes,
      }),
      /attempt_closed/,
    );
    assert.equal(
      (await vault(owner, "get", { connectionId: a.id })).access_token,
      "sealed:access-A",
    );
  } finally {
    await db.close();
  }
});

test("refresh leases serialize processes and cannot resurrect disconnected credentials", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    const row = await vault(owner, "get", { connectionId: a.id }),
      requestId = crypto.randomUUID();
    const input = {
      connectionId: a.id,
      grantId: row.grant_id,
      credentialRevision: row.credential_revision,
      requestId,
    };
    assert.equal((await vault(owner, "claim_refresh", input)).state, "claimed");
    assert.equal(
      (await vault(owner, "claim_refresh", { ...input, requestId: crypto.randomUUID() })).state,
      "busy",
    );
    await vault(owner, "disconnect", { connectionId: a.id, expectedRevision: 1 });
    await assert.rejects(
      vault(owner, "complete_refresh", {
        ...input,
        verifiedSub: "A",
        accessToken: "sealed:late",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      /connection_changed/,
    );
  } finally {
    await db.close();
  }
});
test("legacy mismatched refresh tokens never reach the selected account or persist new credentials", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    await db.query(
      "update google_oauth_tokens set expires_at=now()-interval '1 minute',refresh_token='sealed:wrong-B' where id=$1",
      [a.id],
    );
    const calls = [];
    const api = runtime(vault, async (url, init) => {
      calls.push(url);
      if (url.endsWith("/token")) {
        assert.equal(init.body.get("refresh_token"), "wrong-B");
        return Response.json({ access_token: "B", expires_in: 3600, scope: scopes });
      }
      return userinfo("B");
    });
    await assert.rejects(
      api.accessToken(owner, { connectionId: a.id, capability: "gmail.read" }),
      /connection_changed/,
    );
    const row = await vault(owner, "get", { connectionId: a.id });
    assert.equal(row.access_token, "sealed:access-A");
    assert.equal(row.reauthorization_required, true);
    assert.equal(calls.length, 2);
  } finally {
    await db.close();
  }
});
test("legacy valid tokens are verified and resealed before use without changing their grant", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    await db.query(
      "update google_oauth_tokens set access_token='legacy-access',refresh_token='legacy-refresh',identity_verified=false where id=$1",
      [a.id],
    );
    const before = await vault(owner, "get", { connectionId: a.id });
    const api = runtime(vault, async (url, init) => {
      assert.ok(url.endsWith("/userinfo"));
      assert.equal(init.headers.Authorization, "Bearer legacy-access");
      return userinfo("A");
    });
    assert.equal(await api.accessToken(owner, binding(before)), "legacy-access");
    const after = await vault(owner, "get", { connectionId: a.id });
    assert.equal(after.access_token, "sealed:legacy-access");
    assert.equal(after.refresh_token, "sealed:legacy-refresh");
    assert.equal(after.identity_verified, true);
    assert.equal(after.grant_id, before.grant_id);
    assert.equal(after.credential_revision, before.credential_revision + 1);
  } finally {
    await db.close();
  }
});

test("rotation preserves the verified account, replaces scopes and invalidates earlier write approvals", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    const before = await vault(owner, "get", { connectionId: a.id });
    await db.query(
      "update google_oauth_tokens set expires_at=now()-interval '1 minute' where id=$1",
      [a.id],
    );
    const api = runtime(vault, async (url) =>
      url.endsWith("/token")
        ? Response.json({
            access_token: "fresh-A",
            refresh_token: "rotated-A",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          })
        : userinfo("A"),
    );
    await assert.rejects(api.accessToken(owner, binding(before)), /connection_changed/);
    const row = await vault(owner, "get", { connectionId: a.id });
    assert.equal(row.refresh_token, "sealed:rotated-A");
    assert.notEqual(row.grant_id, before.grant_id);
    assert.equal(hasGoogleCapability(row.scopes, "gmail.write"), false);
    assert.equal(
      await api.accessToken(owner, { connectionId: a.id, capability: "gmail.read" }),
      "fresh-A",
    );
    await assert.rejects(
      api.accessToken(owner, { connectionId: a.id, capability: "gmail.write" }),
      /permission_incomplete/,
    );
  } finally {
    await db.close();
  }
});
test("verified provider identity, targeted reauthorization and deletion fences protect storage", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A"),
      attemptId = crypto.randomUUID();
    await vault(owner, "begin_oauth", { attemptId, connectionId: a.id });
    const api = runtime(vault, async () => userinfo("B"));
    await assert.rejects(
      api.store(owner, { access_token: "B", expires_in: 3600, scope: scopes }, attemptId),
      /connection_changed/,
    );
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(
      vault(owner, "begin_oauth", { attemptId: crypto.randomUUID() }),
      /unavailable/,
    );
    await assert.rejects(vault(owner, "get", { connectionId: a.id }), /unavailable/);
    assert.equal((await vault(owner, "disconnect_all")).length, 1);
    assert.equal(
      (await db.query("select count(*)::int n from google_oauth_tokens where access_token<>''"))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("provider revocation runs only after local credentials are purged and carries tokens in POST body", async () => {
  const { db, vault, connect } = await fixture();
  try {
    const a = await connect(owner, "A");
    let calls = 0;
    const api = runtime(vault, async (url, init) => {
      calls++;
      assert.equal(url, "https://oauth2.googleapis.com/revoke");
      assert.equal(init.body.get("token"), "refresh-A");
      assert.equal(
        (await db.query("select access_token from google_oauth_tokens where id=$1", [a.id])).rows[0]
          .access_token,
        "",
      );
      throw new Error("offline");
    });
    await api.disconnect(owner, a.id, 1);
    assert.equal(calls, 1);
    await assert.rejects(vault(owner, "get", { connectionId: a.id }), /connection_changed/);
  } finally {
    await db.close();
  }
});
test("binding and health contracts fail closed for ambiguous identities, expiry and missing scopes", () => {
  assert.throws(() => parseGoogleBinding({ connectionId: "other-user-id" }));
  assert.throws(() => parseGoogleBinding({ connectionId: owner, capability: "root" }));
  assert.equal(
    googleConnectionHealth({
      id: owner,
      email: null,
      google_sub: null,
      scopes: "",
      expires_at: "bad",
      has_refresh_token: true,
    }).state,
    "reauthorization_required",
  );
  assert.equal(
    hasGoogleCapability("https://www.googleapis.com/auth/gmail.send", "gmail.draft"),
    false,
  );
  assert.equal(
    hasGoogleCapability(
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "calendar.read",
    ),
    true,
  );
});
