import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createGoogleOAuthSettlement } from "../../src/lib/google-oauth-settlement.server.mjs";
const oldMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260905005417_google_multiaccount_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905021737_google_oauth_exchange_settlement.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema kova_private to service_role;
 create table auth.users(id uuid primary key,deleted_at timestamptz);insert into auth.users(id) values('${owner}'),('${other}');
 create function kova_private.auth_user_exists(id uuid)returns boolean language sql security definer as $$select exists(select 1 from auth.users where users.id=$1 and deleted_at is null)$$;revoke all on function kova_private.auth_user_exists(uuid) from public;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
 create table public.account_deletion_fences(user_id uuid primary key);create table public.user_preferences(user_id uuid,settings jsonb);grant all on public.account_deletion_fences,public.user_preferences to service_role;
 create table public.google_oauth_tokens(user_id uuid primary key references auth.users(id)on delete cascade,google_sub text,email text,access_token text not null,refresh_token text,expires_at timestamptz not null,scopes text not null default '',created_at timestamptz default now(),updated_at timestamptz default now());alter table public.google_oauth_tokens enable row level security;`);
  await db.exec(oldMigration);
  await db.exec(migration);
  const call = async (name, user, op, data = {}) => {
    await db.exec("set role service_role");
    try {
      return (
        await db.query(`select public.${name}($1,$2,$3::jsonb) as value`, [
          user,
          op,
          JSON.stringify(data),
        ])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const rpc = async (user, op, data) => {
    if (op === "settle" && data.payload?.accessToken)
      await call("google_oauth_exchange_rpc", user, "stage", data);
    return call("google_oauth_exchange_rpc", user, op, data);
  };
  const vault = (user, op, data) => call("google_connection_rpc", user, op, data);
  const begin = async (user = owner, target) => {
    const attemptId = crypto.randomUUID();
    await vault(user, "begin_oauth", { attemptId, connectionId: target });
    return attemptId;
  };
  const claim = async (user = owner, attemptId) => {
    const claimId = crypto.randomUUID();
    await rpc(user, "claim", { claimId, attemptId });
    return claimId;
  };
  const payload = (sub) => ({
    googleSub: sub,
    email: `${sub}@example.test`,
    accessToken: `sealed:access-${sub}`,
    refreshToken: `sealed:refresh-${sub}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    scopes: "scope",
  });
  const connect = async (user = owner, sub = "A", target) => {
    const attemptId = await begin(user, target),
      claimId = await claim(user, attemptId);
    const settled = await rpc(user, "settle", { claimId, payload: payload(sub) });
    assert.equal(settled.state, "accepted");
    return settled.result;
  };
  return { db, rpc, vault, begin, claim, payload, connect };
}
function runtime(
  rpc,
  {
    exchange = async () => ({
      access_token: "access-B",
      refresh_token: "refresh-B",
      expires_in: 3600,
      scope: "scope",
    }),
    fetchImpl = async () => new Response(null, { status: 200 }),
    identity = async () => ({ sub: "B", email: "B@example.test" }),
    refresh,
  } = {},
) {
  return createGoogleOAuthSettlement({
    rpc,
    exchange,
    identity,
    refresh,
    encrypt: async (v) => `sealed:${v}`,
    decrypt: async (v) => v.replace(/^sealed:/u, ""),
    fetchImpl,
  });
}
const finish = (api, attemptId) =>
  api.finish(
    owner,
    attemptId,
    "code",
    new Request("https://kova.test/api/google/callback"),
    "verifier",
  );

test("closed, replayed and disconnected attempts are rejected before any code exchange", async () => {
  const { db, rpc, vault, begin, claim, connect } = await fixture();
  try {
    const connection = await connect(),
      attemptId = await begin(owner, connection.id);
    await vault(owner, "disconnect", { connectionId: connection.id, expectedRevision: 1 });
    let exchanges = 0;
    const api = runtime(rpc, {
      exchange: async () => {
        exchanges++;
        throw Error("unexpected");
      },
    });
    await assert.rejects(finish(api, attemptId), /attempt_closed/);
    assert.equal(exchanges, 0);
    const next = await begin();
    await claim(owner, next);
    await assert.rejects(finish(api, next), /duplicate/);
    assert.equal(exchanges, 0);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select google_oauth_exchange_rpc($1,'status','{}')", [owner]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from google_oauth_exchange_receipts"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
test("wrong targeted identity is durably rejected and only its unpersisted credentials are revoked", async () => {
  const { db, rpc, vault, begin, connect } = await fixture();
  try {
    const a = await connect(),
      attemptId = await begin(owner, a.id),
      revoked = [];
    const api = runtime(rpc, {
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://oauth2.googleapis.com/revoke");
        revoked.push(init.body.get("token"));
        return new Response(null, { status: 200 });
      },
    });
    await assert.rejects(finish(api, attemptId), /connection_changed/);
    assert.deepEqual(revoked, ["refresh-B"]);
    assert.equal(
      (await vault(owner, "get", { connectionId: a.id })).access_token,
      "sealed:access-A",
    );
    const receipt = (
      await db.query(
        "select state,token_payload from google_oauth_exchange_receipts where attempt_id=$1",
        [attemptId],
      )
    ).rows[0];
    assert.deepEqual(receipt, { state: "revoked", token_payload: null });
  } finally {
    await db.close();
  }
});
test("an ambiguous accepted settlement reconciles its receipt without revoking accepted credentials", async () => {
  const { db, rpc, vault, begin } = await fixture();
  try {
    const attemptId = await begin();
    let revoked = 0,
      failed = false;
    const api = runtime(
      async (...args) => {
        const value = await rpc(...args);
        if (args[1] === "settle" && !failed) {
          failed = true;
          throw Error("response lost");
        }
        return value;
      },
      {
        fetchImpl: async () => {
          revoked++;
          return new Response(null, { status: 200 });
        },
      },
    );
    const result = await finish(api, attemptId);
    assert.equal((await vault(owner, "get", { connectionId: result.id })).google_sub, "B");
    assert.equal(revoked, 0);
  } finally {
    await db.close();
  }
});
test("unavailable reconciliation never guesses that possibly accepted credentials should be revoked", async () => {
  const { db, rpc, begin } = await fixture();
  try {
    const attemptId = await begin();
    let revoked = 0;
    const api = runtime(
      async (...args) => {
        if (args[1] === "status") throw Error("database offline");
        const value = await rpc(...args);
        if (args[1] === "settle") throw Error("response lost");
        return value;
      },
      {
        fetchImpl: async () => {
          revoked++;
          return new Response(null, { status: 200 });
        },
      },
    );
    await assert.rejects(finish(api, attemptId), /offline/);
    assert.equal(revoked, 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from google_oauth_exchange_receipts where state='accepted'",
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
test("compensation protects an accepted same-Google-subject connection belonging to another Kova owner", async () => {
  const { db, rpc, begin, connect, vault } = await fixture();
  try {
    const a = await connect(),
      b = await connect(other, "B"),
      attemptId = await begin(owner, a.id);
    let revoked = 0;
    const api = runtime(rpc, {
      fetchImpl: async () => {
        revoked++;
        return new Response(null, { status: 200 });
      },
    });
    await assert.rejects(finish(api, attemptId), /connection_changed/);
    assert.equal(revoked, 0);
    assert.equal((await vault(other, "get", { connectionId: b.id })).revoked_at, null);
    assert.equal(
      (
        await db.query("select state from google_oauth_exchange_receipts where attempt_id=$1", [
          attemptId,
        ])
      ).rows[0].state,
      "protected",
    );
  } finally {
    await db.close();
  }
});
test("uncertain revocation stays durable and fences concurrent same-subject acceptance until settled", async () => {
  const { db, rpc, begin, claim, payload, connect } = await fixture();
  try {
    const a = await connect(),
      bad = await begin(owner, a.id),
      claimId = await claim(owner, bad);
    assert.equal(
      (await rpc(owner, "settle", { claimId, payload: payload("B") })).state,
      "rejected",
    );
    const concurrent = await begin(),
      concurrentClaim = await claim(owner, concurrent),
      workerId = crypto.randomUUID();
    const item = await rpc(null, "cleanup_claim", { workerId, receiptId: claimId });
    assert.equal(item.id, claimId);
    assert.equal(
      (await rpc(owner, "settle", { claimId: concurrentClaim, payload: payload("B") })).state,
      "rejected",
    );
    await rpc(null, "cleanup_retry", { workerId, receiptId: claimId });
    await db.query(
      "update google_oauth_exchange_receipts set next_cleanup_at=now()-interval '1 second' where id=$1",
      [claimId],
    );
    const worker2 = crypto.randomUUID();
    await rpc(null, "cleanup_claim", { workerId: worker2, receiptId: claimId });
    await rpc(null, "cleanup_done", { workerId: worker2, receiptId: claimId });
    const next = await connect(owner, "B");
    assert.ok(next.id);
  } finally {
    await db.close();
  }
});
test("deletion and Lockdown during an admitted exchange reject persistence but retain safe cleanup", async () => {
  const { db, rpc, begin, claim, payload } = await fixture();
  try {
    const attemptId = await begin(),
      claimId = await claim(owner, attemptId);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    assert.equal(
      (await rpc(owner, "settle", { claimId, payload: payload("B") })).state,
      "rejected",
    );
    const workerId = crypto.randomUUID();
    assert.equal((await rpc(null, "cleanup_claim", { workerId })).id, claimId);
    await rpc(null, "cleanup_done", { workerId, receiptId: claimId });
    await db.query("delete from account_deletion_fences where user_id=$1", [owner]);
    await db.query("insert into user_preferences values($1,$2)", [
      owner,
      JSON.stringify({ lockdown_mode: true }),
    ]);
    const next = await begin();
    await assert.rejects(claim(owner, next), /unavailable/);
  } finally {
    await db.close();
  }
});

test("only explicit invalid_token responses finish rejected credential compensation", async () => {
  const { db, rpc, begin, claim, payload, connect } = await fixture();
  try {
    const a = await connect(),
      attemptId = await begin(owner, a.id),
      claimId = await claim(owner, attemptId);
    await rpc(owner, "settle", { claimId, payload: payload("B") });
    const unknown = runtime(rpc, {
      fetchImpl: async () => Response.json({ error: "invalid_request" }, { status: 400 }),
    });
    assert.equal((await unknown.cleanup({ receiptId: claimId })).processed, 0);
    assert.equal(
      (await db.query("select state from google_oauth_exchange_receipts where id=$1", [claimId]))
        .rows[0].state,
      "rejected",
    );
    await db.query(
      "update google_oauth_exchange_receipts set next_cleanup_at=now()-interval '1 second' where id=$1",
      [claimId],
    );
    const invalid = runtime(rpc, {
      fetchImpl: async () => Response.json({ error: "invalid_token" }, { status: 400 }),
    });
    assert.equal((await invalid.cleanup({ receiptId: claimId })).processed, 1);
    assert.equal(
      (await db.query("select state from google_oauth_exchange_receipts where id=$1", [claimId]))
        .rows[0].state,
      "revoked",
    );
  } finally {
    await db.close();
  }
});

test("post-exchange identity failure retains encrypted credentials and recovers without exchanging the code twice", async () => {
  const { db, rpc, begin, vault } = await fixture();
  try {
    const attemptId = await begin();
    let exchanges = 0,
      identityFails = true,
      revokes = 0;
    const api = runtime(rpc, {
      exchange: async () => {
        exchanges++;
        return { access_token: "access-B", refresh_token: "refresh-B", expires_in: 3600 };
      },
      identity: async () => {
        if (identityFails) throw Error("identity unavailable");
        return { sub: "B", email: "B@example.test" };
      },
      fetchImpl: async () => {
        revokes++;
        return new Response(null, { status: 200 });
      },
    });
    await assert.rejects(finish(api, attemptId), /identity unavailable/);
    let receipt = (
      await db.query("select * from google_oauth_exchange_receipts where attempt_id=$1", [
        attemptId,
      ])
    ).rows[0];
    assert.equal(receipt.state, "staged");
    assert.equal(receipt.token_payload.refreshToken, "sealed:refresh-B");
    assert.equal(revokes, 0);
    identityFails = false;
    assert.equal((await api.cleanup({ receiptId: receipt.id })).processed, 1);
    receipt = (
      await db.query("select * from google_oauth_exchange_receipts where attempt_id=$1", [
        attemptId,
      ])
    ).rows[0];
    assert.equal(receipt.state, "accepted");
    assert.equal(receipt.token_payload, null);
    assert.equal(exchanges, 1);
    assert.equal(
      (await vault(owner, "get", { connectionId: receipt.accepted_result.id })).google_sub,
      "B",
    );
    assert.equal(revokes, 0);
  } finally {
    await db.close();
  }
});
test("staged credentials survive owner deletion for identity-bound compensation only", async () => {
  const { db, rpc, begin, claim, payload } = await fixture();
  try {
    const attemptId = await begin(),
      claimId = await claim(owner, attemptId);
    await rpc(owner, "stage", { claimId, payload: payload("B") });
    await db.query("delete from auth.users where id=$1", [owner]);
    let revoked = 0;
    const api = runtime(rpc, {
      fetchImpl: async () => {
        revoked++;
        return new Response(null, { status: 200 });
      },
    });
    await api.cleanup({ receiptId: claimId });
    assert.equal(
      (await db.query("select state from google_oauth_exchange_receipts where id=$1", [claimId]))
        .rows[0].state,
      "rejected",
    );
    await api.cleanup({ receiptId: claimId });
    assert.equal(revoked, 1);
    assert.equal(
      (
        await db.query("select token_payload from google_oauth_exchange_receipts where id=$1", [
          claimId,
        ])
      ).rows[0].token_payload,
      null,
    );
  } finally {
    await db.close();
  }
});

test("expired staged credentials resolve identity through refresh without reusing the authorization code", async () => {
  const { db, rpc, begin, claim, payload } = await fixture();
  try {
    const attemptId = await begin(),
      claimId = await claim(owner, attemptId);
    await rpc(owner, "stage", { claimId, payload: payload("B") });
    await db.query(
      "update google_oauth_exchange_receipts set token_payload=jsonb_set(token_payload,'{expiresAt}',to_jsonb((now()-interval '1 hour')::text)),claimed_at=now()-interval '3 minutes' where id=$1",
      [claimId],
    );
    let refreshes = 0;
    const api = runtime(rpc, {
      refresh: async (token) => {
        assert.equal(token, "refresh-B");
        refreshes++;
        return { access_token: "renewed-B", expires_in: 3600 };
      },
    });
    await api.cleanup({ receiptId: claimId });
    assert.equal(refreshes, 1);
    assert.equal(
      (await db.query("select state from google_oauth_exchange_receipts where id=$1", [claimId]))
        .rows[0].state,
      "rejected",
    );
  } finally {
    await db.close();
  }
});
test("explicit invalid refresh only purges staged tokens after their access lifetime has expired", async () => {
  const { db, rpc, begin, claim, payload } = await fixture();
  try {
    const attemptId = await begin(),
      claimId = await claim(owner, attemptId);
    await rpc(owner, "stage", { claimId, payload: payload("B") });
    await db.query(
      "update google_oauth_exchange_receipts set token_payload=jsonb_set(token_payload,'{expiresAt}',to_jsonb((now()-interval '1 hour')::text)) where id=$1",
      [claimId],
    );
    const api = runtime(rpc, {
      refresh: async () => {
        throw Error("google_staged_refresh_invalid");
      },
    });
    await api.cleanup({ receiptId: claimId });
    assert.deepEqual(
      (
        await db.query(
          "select state,token_payload from google_oauth_exchange_receipts where id=$1",
          [claimId],
        )
      ).rows[0],
      { state: "revoked", token_payload: null },
    );
  } finally {
    await db.close();
  }
});
