import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture,
  rpc,
  id,
  owner,
  other,
  client,
  request,
  grant,
  key,
  code,
  resource,
  redirect,
  hash,
  digest,
  limits,
  approve,
  exchange,
  validate,
} from "../helpers/mcp-oauth-fixture.mjs";

test("OAuth RPCs are service-only without Auth SELECT, consent binds exact owner/project/request/scopes/limits", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    assert.equal(
      (await db.query("select has_table_privilege('service_role','auth.users','select') ok"))
        .rows[0].ok,
      false,
    );
    assert.equal(f.details.projects[0].id, f.account.projectId);
    await assert.rejects(rpc(db, "read_mcp_oauth_consent", [other, request]), /invalid_request/);
    for (const change of [
      { hash: "c".repeat(64) },
      { project: id(99) },
      { scopes: ["image_generation"] },
      { scopes: ["chat", "chat"] },
      { limits: { ...limits, request: 2 } },
      { limits: { request: 1 } },
      { limits: { ...limits, concurrent: 2.5 } },
    ])
      await assert.rejects(approve(f, change), /invalid_request|access_denied|invalid input/);
    assert.equal((await db.query("select count(*)::int n from mcp_oauth_grants")).rows[0].n, 0);
    await approve(f);
    const row = (
      await db.query(
        "select credential_owner,capabilities,expires_at,secret_digest from developer_billing_keys where id=$1",
        [key],
      )
    ).rows[0];
    assert.equal(row.credential_owner, owner);
    assert.deepEqual(row.capabilities, ["chat", "files"]);
    assert.equal(row.secret_digest, digest);
    assert.ok(new Date(row.expires_at) - Date.now() <= 30 * 86400000);
    await assert.rejects(approve(f), /invalid_request/);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(rpc(db, "read_mcp_oauth_consent", [owner, request]), /permission denied/);
    await assert.rejects(db.query("select * from mcp_oauth_tokens"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("code exchange requires exact PKCE/client/redirect/resource and a successful replay revokes its metering key", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    for (const change of [
      { digest: hash },
      { challenge: "d".repeat(43) },
      { client: id(99) },
      { redirect: redirect + "x" },
      { resource: resource + "/other" },
    ])
      assert.equal((await exchange(db, change)).error, "invalid_grant");
    const issued = await exchange(db);
    assert.equal(issued.refreshAllowed, true);
    assert.equal(issued.expiresIn, 900);
    assert.deepEqual((await validate(db)).capabilities, ["chat", "files"]);
    assert.equal(await validate(db, id(20), digest), null);
    assert.equal(await validate(db, id(20), hash, resource + "/other"), null);
    assert.equal((await exchange(db, { access: id(22), refresh: id(23) })).error, "invalid_grant");
    assert.equal(await validate(db), null);
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      false,
    );
  } finally {
    await db.close();
  }
});
test("refresh is rotating, scope-reducing, client-bound and replay durably revokes the whole connection", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    const refresh = {
      kind: "refresh",
      token: id(21),
      digest: hash,
      redirect: null,
      challenge: null,
      access: id(22),
      refresh: id(23),
    };
    assert.equal(
      (await exchange(db, { ...refresh, scopes: ["image_generation"] })).error,
      "invalid_scope",
    );
    assert.equal((await exchange(db, { ...refresh, client: id(99) })).error, "invalid_grant");
    assert.equal((await exchange(db, { ...refresh, scopes: ["chat"] })).scope, "chat");
    assert.deepEqual((await validate(db, id(22))).capabilities, ["chat"]);
    assert.equal(
      (await exchange(db, { ...refresh, access: id(24), refresh: id(25) })).error,
      "invalid_grant",
    );
    assert.equal(await validate(db, id(22)), null);
    assert.equal(await validate(db), null);
  } finally {
    await db.close();
  }
});
test("a code-only registration receives no refresh credential, and denial creates no metering key", async () => {
  const f = await fixture({ refresh: false });
  const { db } = f;
  try {
    assert.equal(f.details.refreshAllowed, false);
    await approve(f);
    assert.equal((await exchange(db)).refreshAllowed, false);
    assert.equal(
      (await db.query("select count(*)::int n from mcp_oauth_tokens where kind='refresh'")).rows[0]
        .n,
      0,
    );
    assert.equal(
      (await exchange(db, { kind: "refresh", token: id(21), digest: hash })).error,
      "invalid_grant",
    );
    const r = id(30);
    await rpc(db, "begin_mcp_oauth_request", [r, client, f.input, hash]);
    await rpc(db, "read_mcp_oauth_consent", [owner, r]);
    assert.equal((await approve(f, { request: r, approve: false })).denied, true);
    assert.equal(
      (await db.query("select count(*)::int n from developer_billing_keys")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("current fences, Lockdown, key capability and project ownership are rechecked; revocation still works while deleting", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    await db.exec("reset role");
    await db.query("insert into user_preferences values($1,'{\"lockdown_mode\":true}')", [owner]);
    await db.exec("set role service_role");
    assert.equal(await validate(db), null);
    await db.exec("reset role;delete from user_preferences");
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await db.exec("set role service_role");
    assert.equal(await validate(db), null);
    await assert.rejects(rpc(db, "read_mcp_oauth_consent", [owner, request]), /access_denied/);
    assert.equal(await rpc(db, "revoke_mcp_oauth_grant", [other, grant]), false);
    assert.equal(await rpc(db, "revoke_mcp_oauth_grant", [owner, grant]), true);
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      false,
    );
  } finally {
    await db.close();
  }
});
test("OAuth grants share the canonical account key cap and failed consent cannot grow credentials", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await db.query(
      "insert into developer_billing_keys(id,account_id,project_id,credential_owner,enabled,expires_at,capabilities,secret_digest,secret_suffix,name) select gen_random_uuid(),$1,$2,$3,true,now()+interval '1 day',array['chat'],$4,'abc123','fixture' from generate_series(1,100)",
      [f.account.accountId, f.account.projectId, owner, digest],
    );
    await assert.rejects(approve(f), /capacity/);
    assert.equal((await db.query("select count(*)::int n from mcp_oauth_grants")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
test("client metadata cannot change after consent and client retirement disables every backing key", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    await assert.rejects(
      db.query(
        "update mcp_oauth_clients set metadata=jsonb_set(metadata,'{redirect_uris}','[\"https://evil.example/callback\"]') where id=$1",
        [client],
      ),
      /immutable/,
    );
    await assert.rejects(rpc(db, "retire_mcp_oauth_client", [other, client]), /access_denied/);
    assert.equal(await rpc(db, "retire_mcp_oauth_client", [owner, client]), true);
    assert.equal(await validate(db), null);
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      false,
    );
  } finally {
    await db.close();
  }
});
test("actual Auth deletion cascades private grants/tokens and retires registration with only Auth administrator permissions", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    await db.exec("reset role;set role auth_admin");
    await db.query("delete from auth.users where id=$1", [owner]);
    await db.exec("reset role;set role service_role");
    for (const table of [
      "mcp_oauth_grants",
      "mcp_oauth_codes",
      "mcp_oauth_tokens",
      "mcp_oauth_requests",
      "developer_billing_keys",
    ])
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0, table);
    const c = (
      await db.query("select registered_by,active from mcp_oauth_clients where id=$1", [client])
    ).rows[0];
    assert.equal(c.registered_by, null);
    assert.equal(c.active, false);
  } finally {
    await db.close();
  }
});
test("owner export and connection views include currency and exclude credential digests/codes/PKCE", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    const row = (
      await db.query("select * from mcp_oauth_grant_export_rows where owner_id=$1", [owner])
    ).rows[0];
    assert.equal(row.currency, "USD");
    assert.equal(/digest|secret|challenge|code|key_id/.test(JSON.stringify(row)), false);
    assert.equal(await rpc(db, "revoke_mcp_oauth_token", [id(99), id(21), hash]), false);
    assert.ok(await validate(db));
    assert.equal(await rpc(db, "revoke_mcp_oauth_token", [client, id(21), hash]), true);
    assert.equal(await validate(db), null);
  } finally {
    await db.close();
  }
});

test("OAuth revocation between paid admission and provider dispatch uses the canonical billing fence", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await approve(f);
    await exchange(db);
    const version = id(70);
    await db.query("update developer_credit_accounts set available_amount=100 where id=$1", [
      f.account.accountId,
    ]);
    await db.query(
      "insert into api_pricing_versions(id,version,currency,minimum_request_charge,rounding_increment,allowance_configuration,public_price_configuration,status,approved_by,approved_at,effective_at,expires_at) values($1,1,'USD',.01,.001,'{}','{}','approved',$2,now(),now()-interval '1 hour',now()+interval '1 day')",
      [version, owner],
    );
    const quote = {
      pricingVersionId: version,
      currency: "USD",
      customerCharge: 0.5,
      maximumReservedCharge: 0.5,
      promotionalSubsidy: 0,
      estimatedUpstreamCost: 0.1,
      riskBufferAmount: 0,
      roundingDifference: 0,
      upstreamBreakdown: { input_tokens: 0.1 },
    };
    const admitted = (
      await db.query(
        "select admit_developer_billing($1,'mcp-admitted',$2,'azure_openai','luna','chat',$3,$4,'{}') result",
        [key, hash, version, quote],
      )
    ).rows[0].result;
    assert.ok(admitted.request_id);
    await rpc(db, "revoke_mcp_oauth_grant", [owner, grant]);
    assert.equal(
      (
        await db.query("select dispatch_developer_billing($1,$2) ok", [
          admitted.request_id,
          admitted.lease_token,
        ])
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select reserved_amount::float8 amount from developer_credit_accounts where id=$1",
          [f.account.accountId],
        )
      ).rows[0].amount,
      0.5,
    );
  } finally {
    await db.close();
  }
});
