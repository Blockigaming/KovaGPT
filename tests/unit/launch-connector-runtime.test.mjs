import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { connectorDatabase, OWNER_A, OWNER_B } from "../helpers/launch-connector-database.mjs";
import {
  encryptCredential,
  decryptCredential,
} from "../../src/integrations/credential-vault.server.ts";
import { createLaunchRuntime } from "../../src/integrations/launch-runtime.server.mjs";
import { ConnectorError } from "../../src/integrations/launch-contracts.mjs";
process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const origin = "https://kova.example",
  sessionId = "session-a";
const principal = { ownerId: OWNER_A, sessionId, connector: "outlook" };
const sha = (v) => createHash("sha256").update(v).digest("hex");
async function fixture(t) {
  const store = await connectorDatabase();
  t.after(() => store.close());
  const state = {
    ownerId: OWNER_A,
    sessionId,
    locked: false,
    calls: [],
    hook: null,
    profile: "ms-user",
    messages: { value: [{ id: "m1", subject: "Private" }] },
  };
  const options = {
    ...store,
    encrypt: encryptCredential,
    decrypt: decryptCredential,
    env: {
      KOVA_CONNECTOR_PUBLIC_ORIGIN: origin,
      MICROSOFT_OAUTH_CLIENT_ID: "fixture-client",
      MICROSOFT_OAUTH_CLIENT_SECRET: "fixture-secret",
    },
    assertCertified: () => {},
    assertSession: async (owner, session) => {
      if (owner !== state.ownerId || session !== state.sessionId)
        throw new ConnectorError("oauth_session_changed", 401);
    },
    assertAllowed: async () => {
      if (state.locked) throw new ConnectorError("lockdown", 403);
    },
    transport: {
      fetchImpl: async (url, init) => {
        state.calls.push({ url, init });
        const override = await state.hook?.(url, init);
        if (override) return override;
        if (url.includes("/oauth2/v2.0/token"))
          return Response.json({
            access_token: "fixture-access",
            refresh_token: "fixture-refresh",
            expires_in: 3600,
            scope: "Mail.Read",
          });
        if (url.includes("/me?"))
          return Response.json({ id: state.profile, userPrincipalName: "fixture@example.test" });
        return Response.json(state.messages);
      },
    },
  };
  const runtime = createLaunchRuntime(options);
  const begin = async () => {
    const r = await runtime.begin({
      ...principal,
      browserNonce: "browser-a",
      origin,
      returnPath: "/apps",
    });
    return {
      connector: "outlook",
      state: new URL(r.url).searchParams.get("state"),
      code: "fixture-code",
      browserNonce: "browser-a",
      origin,
    };
  };
  const connect = async () => {
    const result = await runtime.complete(await begin());
    return result.account.id;
  };
  const row = async (id) =>
    (await store.sql.query("select * from integration_linked_accounts where id=$1", [id])).rows[0];
  const read = (accountId, extra = {}) =>
    runtime.execute({ ...principal, accountId, operation: "list_messages", ...extra });
  return { ...store, state, options, runtime, begin, connect, row, read };
}
test("default certification gate rejects OAuth and reads before provider or DB access", async () => {
  const runtime = createLaunchRuntime({
    db: null,
    encrypt: null,
    decrypt: null,
    assertSession: async () => {
      throw new Error("must not run");
    },
    assertAllowed: async () => {},
  });
  await assert.rejects(
    runtime.begin({ ...principal, origin, browserNonce: "a" }),
    /connector_not_certified/,
  );
  await assert.rejects(
    runtime.execute({ ...principal, accountId: "id", operation: "list_messages" }),
    /connector_not_certified/,
  );
});
test("OAuth uses encrypted session state, settles after a real read, rejects replay", async (t) => {
  const f = await fixture(t),
    callback = await f.begin();
  const state = (await f.sql.query("select * from integration_oauth_states")).rows[0];
  assert.equal(state.state_hash, sha(callback.state));
  assert.ok(!state.pkce_verifier_ciphertext.includes(OWNER_A));
  const transaction = JSON.parse(await decryptCredential(state.pkce_verifier_ciphertext));
  assert.equal(transaction.sessionId, sessionId);
  const result = await f.runtime.complete(callback),
    row = await f.row(result.account.id);
  assert.equal(row.status, "connected");
  assert.equal(row.owner_id, OWNER_A);
  assert.ok(row.access_token_ciphertext.startsWith("v1."));
  assert.equal(row.refresh_token_ciphertext, null);
  assert.ok(f.state.calls.some((c) => c.url.includes("/me/messages")));
  assert.ok(!JSON.stringify(result).includes("fixture-access"));
  await assert.rejects(f.runtime.complete(callback), /invalid_oauth_state/);
});
test("OAuth callback rejects changed session, wrong nonce and wrong origin without exchanging", async (t) => {
  const f = await fixture(t),
    cb = await f.begin();
  await assert.rejects(f.runtime.complete({ ...cb, browserNonce: "other" }), /invalid_oauth_state/);
  await assert.rejects(
    f.runtime.complete({ ...cb, origin: "https://evil.test" }),
    /invalid_oauth_state/,
  );
  f.state.sessionId = "session-b";
  await assert.rejects(f.runtime.complete(cb), /oauth_session_changed/);
  assert.equal(f.state.calls.length, 0);
});
test("consent cannot settle when the real provider operation lacks permission", async (t) => {
  const f = await fixture(t);
  f.state.hook = async (u) =>
    u.includes("/me/messages") ? new Response("sensitive", { status: 403 }) : null;
  await assert.rejects(f.runtime.complete(await f.begin()), /permission_incomplete/);
  assert.equal((await f.sql.query("select * from integration_linked_accounts")).rows.length, 0);
});
test("foreign accounts cannot be read or disconnected and ciphertext is owner-bound", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  f.state.ownerId = OWNER_B;
  await assert.rejects(f.read(id, { ownerId: OWNER_B }), /not_connected/);
  await assert.rejects(
    f.runtime.disconnect({ ownerId: OWNER_B, connector: "outlook", accountId: id }),
    /connector_disconnect_failed/,
  );
  assert.equal((await f.row(id)).status, "connected");
  f.state.ownerId = OWNER_A;
  const r = await f.row(id);
  await f.sql.query(
    "update integration_linked_accounts set access_token_ciphertext=$1 where id=$2",
    [
      await encryptCredential(
        JSON.stringify({
          version: 1,
          ownerId: OWNER_B,
          connector: "outlook",
          token: { subject: r.provider_account_id },
        }),
      ),
      id,
    ],
  );
  await assert.rejects(f.read(id), /reauthorization_required/);
});
test("disconnect destroys credentials and cancels pending work even during lockdown", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  await f.sql.query(
    "insert into integration_sync_jobs(owner_id,linked_account_id,kind) values($1,$2,'initial')",
    [OWNER_A, id],
  );
  await f.sql.query(
    "insert into integration_action_approvals(owner_id,linked_account_id,tool_name,safe_summary,expires_at) values($1,$2,'read','fixture',now()+interval '1 hour')",
    [OWNER_A, id],
  );
  f.state.locked = true;
  const result = await f.runtime.disconnect({
    ownerId: OWNER_A,
    connector: "outlook",
    accountId: id,
  });
  assert.deepEqual(result, {
    localDisconnected: true,
    providerRevoked: false,
    remoteStatus: "manual_revocation_required",
    cleanupRecorded: true,
  });
  assert.equal((await f.row(id)).access_token_ciphertext, "deleted");
  assert.equal(
    (await f.sql.query("select status from integration_sync_jobs")).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (await f.sql.query("select status from integration_action_approvals")).rows[0].status,
    "denied",
  );
});
test("disconnect wins against an OAuth callback already exchanging its code", async (t) => {
  const f = await fixture(t),
    id = await f.connect(),
    cb = await f.begin();
  f.state.hook = async (u) => {
    if (u.includes("/oauth2/v2.0/token")) {
      f.state.hook = null;
      await f.runtime.disconnect({ ownerId: OWNER_A, connector: "outlook", accountId: id });
    }
    return null;
  };
  await assert.rejects(f.runtime.complete(cb), /oauth_settlement_failed/);
  assert.equal((await f.row(id)).status, "revoked");
});
test("in-flight reads cannot expose data after disconnect or session changes", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  f.state.hook = async (u) => {
    if (u.includes("/me/messages")) {
      f.state.hook = null;
      await f.runtime.disconnect({ ownerId: OWNER_A, connector: "outlook", accountId: id });
    }
    return null;
  };
  await assert.rejects(f.read(id), /not_connected/);
  const id2 = await f.connect();
  f.state.hook = async (u) => {
    if (u.includes("/me/messages")) f.state.sessionId = "new-session";
    return null;
  };
  await assert.rejects(f.read(id2), /oauth_session_changed/);
});
async function expire(f, id) {
  const row = await f.row(id);
  const envelope = JSON.parse(await decryptCredential(row.access_token_ciphertext));
  envelope.token.expiresAt = "2020-01-01T00:00:00Z";
  await f.sql.query(
    "update integration_linked_accounts set access_token_ciphertext=$1 where id=$2",
    [await encryptCredential(JSON.stringify(envelope)), id],
  );
}
test("refresh rotates the encrypted revision and preserves provider account identity", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  await expire(f, id);
  const before = await f.row(id);
  const out = await f.read(id);
  assert.equal(out.items[0].subject, "Private");
  const after = await f.row(id);
  assert.equal(after.status, "connected");
  assert.notEqual(before.access_token_ciphertext, after.access_token_ciphertext);
  assert.ok(f.state.calls.some((c) => c.init.body?.get?.("grant_type") === "refresh_token"));
});
test("DB refresh CAS prevents a second token exchange and disconnect prevents resurrection", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  await expire(f, id);
  let refreshes = 0;
  f.state.hook = async (u, init) => {
    if (init.body?.get?.("grant_type") === "refresh_token") {
      refreshes++;
      await assert.rejects(f.read(id), /not_connected/);
      await f.runtime.disconnect({ ownerId: OWNER_A, connector: "outlook", accountId: id });
    }
    return null;
  };
  await assert.rejects(f.read(id), /connection_changed/);
  assert.equal(refreshes, 1);
  assert.equal((await f.row(id)).access_token_ciphertext, "deleted");
});
test("401 retries once with refresh; terminal permission failure invalidates the account", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  let reads = 0;
  f.state.hook = async (u) =>
    u.includes("/me/messages") && ++reads === 1 ? new Response(null, { status: 401 }) : null;
  assert.equal((await f.read(id)).items.length, 1);
  assert.equal(reads, 2);
  f.state.hook = async (u) =>
    u.includes("/me/messages") ? new Response(null, { status: 403 }) : null;
  await assert.rejects(f.read(id), /permission_incomplete/);
  assert.equal((await f.row(id)).status, "permission_incomplete");
});
test("provider identity changes during refresh require reconnection", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  await expire(f, id);
  f.state.profile = "other-ms-user";
  await assert.rejects(f.read(id), /oauth_account_changed/);
  assert.equal((await f.row(id)).status, "error");
});
test("encrypted pagination binds owner, account, query and credential revision", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  f.state.messages = {
    value: [],
    "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skip=25",
  };
  const { nextCursor } = await f.read(id);
  assert.ok(nextCursor.startsWith("v1."));
  assert.ok(!nextCursor.includes("graph.microsoft.com"));
  await f.read(id, { cursor: nextCursor });
  assert.ok(f.state.calls.at(-1).url.includes("$skip=25"));
  await assert.rejects(
    f.read(id, { cursor: nextCursor, operation: "read_message", args: { id: "m1" } }),
    /invalid_cursor/,
  );
  const parsed = JSON.parse(await decryptCredential(nextCursor));
  for (const replacement of [
    { ownerId: OWNER_B },
    { accountId: OWNER_B },
    { revision: "old" },
    { expires: 0 },
  ])
    await assert.rejects(
      f.read(id, {
        cursor: await encryptCredential(JSON.stringify({ ...parsed, ...replacement })),
      }),
      /invalid_cursor/,
    );
});
test("actual SQL migration prevents authenticated token reads and cross-owner metadata access", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  await f.sql.exec(`set role authenticated; set "request.jwt.claim.sub"='${OWNER_B}';`);
  assert.equal(
    (await f.sql.query("select id,account_label from integration_linked_accounts")).rows.length,
    0,
  );
  await f.sql.exec(`set "request.jwt.claim.sub"='${OWNER_A}';`);
  assert.equal((await f.sql.query("select id from integration_linked_accounts")).rows[0].id, id);
  await assert.rejects(
    f.sql.query("select access_token_ciphertext from integration_linked_accounts"),
    /permission denied/,
  );
  await assert.rejects(
    f.sql.query("select public.disconnect_launch_connector($1,$2,$3)", [OWNER_A, "outlook", id]),
    /permission denied/,
  );
  await f.sql.exec("reset role");
  const flags = (
    await f.sql.query(
      "select proname,prosecdef from pg_proc where proname in ('settle_launch_connector','disconnect_launch_connector')",
    )
  ).rows;
  assert.equal(flags.length, 2);
  assert.ok(flags.every((r) => r.prosecdef === false));
});
