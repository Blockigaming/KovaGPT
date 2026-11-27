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

test("vector stores persist cosine retrieval, enforce scopes and erase linked file entries", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_vector_stores_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    await f.db.query(
      "update developer_billing_keys set capabilities=array['chat','files','embeddings'] where id=$1",
      [key],
    );
    const run = async (operation, input, identity = [owner, key, f.account.projectId]) =>
      (
        await f.db.query("select manage_developer_vector_stores_v1($1,$2,$3,$4,$5) result", [
          ...identity,
          operation,
          input,
        ])
      ).rows[0].result;
    const input = { name: "Docs", model: "kova-embedding", dimensions: 3, request_digest: "c".repeat(64) };
    const store = await run("create", input);
    assert.equal((await run("create", input)).id, store.id);
    await assert.rejects(run("create", { ...input, name: "Other" }), /vector_conflict/);
    const linked = await f.file("create", upload("relevant document"));
    const base = { store_id: store.id, model: input.model };
    await run("upsert", {
      ...base,
      entry_id: "relevant",
      vector: [2, 0, 0],
      text: "relevant document",
      file_id: linked.id,
    });
    await run("upsert", {
      ...base,
      entry_id: "different",
      vector: [0, 1, 0],
      text: "other text",
    });
    const search = await run("search", { ...base, vector: [1, 0, 0], limit: 2 });
    assert.equal(search.search_type, "cosine");
    assert.deepEqual(search.data.map((row) => row.entry_id), ["relevant", "different"]);
    assert.equal(search.data[0].score, 1);
    assert.equal(search.data[1].score, 0);
    const entry = await run("get_entry", { store_id: store.id, entry_id: "relevant" });
    assert.deepEqual(entry.embedding, [1, 0, 0]);
    await assert.rejects(run("search", { ...base, vector: [1, 0], limit: 2 }), /vector_invalid/);
    await assert.rejects(
      run("search", { ...base, model: "different", vector: [1, 0, 0], limit: 2 }),
      /vector_invalid/,
    );
    await assert.rejects(
      run("get", { store_id: store.id }, [other, key, f.account.projectId]),
      /scope_required/,
    );
    await f.file("delete", { id: linked.id });
    assert.deepEqual(
      (await run("search", { ...base, vector: [1, 0, 0], limit: 2 })).data.map((row) => row.entry_id),
      ["different"],
    );
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (await f.db.query("select has_table_privilege($1,'developer_vector_entries_v1','select') allowed", [role])).rows[0].allowed,
        false,
      );
    await f.db.query("update developer_billing_keys set capabilities=array['files'] where id=$1", [key]);
    await assert.rejects(run("get", { store_id: store.id }), /scope_required/);
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal((await f.db.query("select count(*)::int n from developer_vector_stores_v1")).rows[0].n, 0);
  } finally {
    await f.db.close();
  }
});

test("developer conversations serialize revisions, retain retry fences and erase content", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_conversations_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    const run = async (operation, input, user = owner) =>
      (
        await f.db.query("select manage_developer_conversations_v1($1,$2,$3,$4,$5) result", [
          user, key, f.account.projectId, operation, input,
        ])
      ).rows[0].result;
    const conversation = id(50), itemId = id(51), otherItem = id(52);
    const item = { id: itemId, role: "user", content: "private example" };
    const create = { id: conversation, title: "Example" };
    assert.equal((await run("create", create)).revision, 0);
    assert.equal((await run("create", create)).id, conversation);
    const append = { id: conversation, expected_revision: 0, item };
    assert.equal((await run("append", append)).revision, 1);
    assert.equal((await run("append", append)).revision, 1);
    await assert.rejects(
      run("append", { ...append, item: { ...item, content: "changed" } }),
      /conversation_conflict/,
    );
    await assert.rejects(
      run("append", { ...append, item: { ...item, id: otherItem } }),
      /conversation_conflict/,
    );
    assert.deepEqual((await run("get", { id: conversation })).items, [item]);
    assert.equal((await run("get_item", { id: conversation, item_id: itemId })).item.content, item.content);
    assert.equal((await run("list", {})).data[0].items, undefined);
    await assert.rejects(run("get", { id: conversation }, other), /scope_required/);
    const remove = { id: conversation, item_id: itemId, expected_revision: 1 };
    assert.equal((await run("remove", remove)).revision, 2);
    assert.equal((await run("remove", remove)).revision, 2);
    assert.deepEqual((await run("get", { id: conversation })).items, []);
    await assert.rejects(run("get_item", { id: conversation, item_id: itemId }), /not_found/);
    await assert.rejects(run("append", append), /conversation_conflict/);
    const exported = (await f.db.query("select items from developer_conversation_export_records_v1")).rows[0];
    assert.deepEqual(exported.items, [{ id: itemId, deleted: true }]);
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (await f.db.query("select has_table_privilege($1,'developer_conversations_v1','select') allowed", [role])).rows[0].allowed,
        false,
      );
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal(
      (await f.db.query("select count(*)::int n from developer_conversations_v1")).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("agent definitions preserve immutable revisions and owner boundaries", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_agents_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    const run = async (operation, input, user = owner) =>
      (
        await f.db.query("select manage_developer_agents_v1($1,$2,$3,$4,$5) result", [
          user, key, f.account.projectId, operation, input,
        ])
      ).rows[0].result;
    const agent = id(61);
    const definition = {
      name: "Reviewer",
      model: "kova-fast",
      instructions: "Summarize evidence.",
      max_output_tokens: 100,
    };
    const create = { id: agent, definition };
    assert.equal((await run("create", create)).version, 1);
    assert.equal((await run("create", create)).version, 1);
    const update = {
      id: agent,
      expected_version: 1,
      definition: { ...definition, instructions: "List evidence." },
    };
    assert.equal((await run("update", update)).version, 2);
    assert.equal((await run("update", update)).version, 2);
    await assert.rejects(
      run("update", { ...update, definition: { ...definition, instructions: "Changed" } }),
      /agent_conflict/,
    );
    assert.equal(
      (await run("get", { id: agent, version: 1 })).definition.instructions,
      definition.instructions,
    );
    assert.equal((await run("get", { id: agent })).version, 2);
    assert.equal((await run("list", {})).data[0].definition, undefined);
    await assert.rejects(run("get", { id: agent }, other), /scope_required/);
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (await f.db.query("select has_table_privilege($1,'developer_agent_versions_v1','select') allowed", [role])).rows[0].allowed,
        false,
      );
    await run("delete", { id: agent });
    await assert.rejects(run("get", { id: agent, version: 1 }), /agent_not_found/);
    await run("create", create);
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal(
      (await f.db.query("select count(*)::int n from developer_agent_versions_v1")).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("skill versions are private, immutable and project scoped", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_skills_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    const run = async (operation, input, user = owner) =>
      (
        await f.db.query("select manage_developer_skills_v1($1,$2,$3,$4,$5) result", [
          user, key, f.account.projectId, operation, input,
        ])
      ).rows[0].result;
    const skill = id(71);
    const definition = {
      name: "Review",
      description: "Review evidence",
      instructions: "Cite the evidence.",
    };
    const create = { id: skill, definition };
    assert.equal((await run("create", create)).version, 1);
    assert.equal((await run("create", create)).version, 1);
    await assert.rejects(run("create", { ...create, definition: { ...definition, code: "run" } }), /skill_invalid/);
    const update = { id: skill, expected_version: 1, definition: { ...definition, instructions: "List evidence." } };
    assert.equal((await run("update", update)).version, 2);
    assert.equal((await run("update", update)).version, 2);
    await assert.rejects(run("update", { ...update, definition: { ...definition, instructions: "Changed" } }), /skill_conflict/);
    assert.equal((await run("get", { id: skill, version: 1 })).definition.instructions, definition.instructions);
    assert.equal((await run("get", { id: skill })).version, 2);
    assert.equal((await run("list", {})).data[0].definition, undefined);
    await assert.rejects(run("get", { id: skill }, other), /scope_required/);
    for (const role of ["anon", "authenticated"])
      assert.equal((await f.db.query("select has_table_privilege($1,'developer_skill_versions_v1','select') allowed", [role])).rows[0].allowed, false);
    await run("delete", { id: skill });
    await assert.rejects(run("get", { id: skill, version: 1 }), /skill_not_found/);
    await run("create", create);
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal((await f.db.query("select count(*)::int n from developer_skill_versions_v1")).rows[0].n, 0);
  } finally {
    await f.db.close();
  }
});

test("outgoing webhook registration, stable test events, lease retry and rotation remain key scoped", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_webhooks_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    const run = async (operation, input, user = owner) =>
      (
        await f.db.query("select manage_developer_webhooks_v1($1,$2,$3,$4,$5) result", [
          user, key, f.account.projectId, operation, input,
        ])
      ).rows[0].result;
    const endpoint = id(81), event = id(82);
    const create = { id: endpoint, url: "https://hooks.example.com/kova", events: ["request.settled"] };
    const first = await run("create", create);
    assert.equal(first.generation, 1);
    assert.equal((await run("create", create)).secret_nonce, first.secret_nonce);
    assert.equal((await run("get", { id: endpoint })).secret_nonce, undefined);
    await assert.rejects(run("get", { id: endpoint }, other), /scope_required/);
    await assert.rejects(run("create", { ...create, url: "https://hooks.example.com/other" }), /webhook_conflict/);
    assert.equal((await run("rotate", { id: endpoint, expected_generation: 1 })).generation, 2);
    assert.equal((await run("rotate", { id: endpoint, expected_generation: 1 })).generation, 2);
    await run("test", { id: endpoint, event_id: event });
    await run("test", { id: endpoint, event_id: event });
    const claim = async () => (await f.db.query("select claim_developer_webhooks_v1(3) result")).rows[0].result;
    const claimed = await claim();
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].event.id, event);
    assert.equal(claimed[0].event.type, "webhook.test");
    assert.equal(claimed[0].endpoint.generation, 2);
    assert.deepEqual(await claim(), []);
    const finish = async (lease, status) =>
      (await f.db.query("select finish_developer_webhook_v1($1,$2,$3,$4,$5) result", [
        f.account.projectId, endpoint, event, lease, status,
      ])).rows[0].result;
    assert.equal(await finish(id(99), 200), false);
    assert.equal(await finish(claimed[0].lease_token, 503), true);
    assert.equal((await run("deliveries", { id: endpoint })).data[0].status, "pending");
    assert.deepEqual(await claim(), []);
    await f.db.query("update developer_webhook_deliveries_v1 set next_attempt_at=now()-interval '1 second' where id=$1", [event]);
    const retry = await claim();
    assert.equal(retry[0].event.id, event);
    assert.notEqual(retry[0].lease_token, claimed[0].lease_token);
    assert.equal(await finish(retry[0].lease_token, 204), true);
    assert.equal((await run("deliveries", { id: endpoint })).data[0].status, "delivered");
    assert.deepEqual(await claim(), []);
    for (const role of ["anon","authenticated"])
      assert.equal((await f.db.query("select has_table_privilege($1,'developer_webhook_endpoints_v1','select') allowed", [role])).rows[0].allowed, false);
    await run("delete", { id: endpoint });
    assert.equal((await f.db.query("select count(*)::int n from developer_webhook_deliveries_v1")).rows[0].n, 0);
  } finally {
    await f.db.close();
  }
});

test("batch leases, aggregate maximums, cancellation and isolation", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.exec(await readFile("supabase/pending/developer_batches_v1.sql", "utf8"));
    await f.db.exec("set role service_role");
    const run = async (operation, input, user = owner) =>
      (await f.db.query("select manage_developer_batches_v1($1,$2,$3,$4,$5) result", [
        user, key, f.account.projectId, operation, input,
      ])).rows[0].result;
    const batch = id(91), first = id(92), second = id(93);
    const item = (id, n) => ({
      id, input: { model: "kova-fast", messages: [{ role: "user", content: "hello" }], max_completion_tokens: 100 },
      authorization: "test-authorization", maximum_ticks: 100, request_group: n.repeat(64),
    });
    const input = {
      id: batch, currency: "USD", maximum_ticks: 200, request_digest: "a".repeat(64),
      expires_at: new Date(Date.now() + 3600000).toISOString(), items: [item(first, "b"), item(second, "c")],
    };
    await assert.rejects(run("create", { ...input, maximum_ticks: 199 }), /batch_budget_invalid/);
    assert.equal((await run("create", input)).id, batch);
    assert.equal((await run("create", input)).id, batch);
    await assert.rejects(run("create", { ...input, request_digest: "d".repeat(64) }), /batch_conflict/);
    await assert.rejects(run("get", { id: batch }, other), /scope_required/);
    const claim = async () => (await f.db.query("select claim_developer_batch_v1() result")).rows[0].result;
    const claimed = await claim();
    assert.equal(claimed.item.id, first);
    assert.equal(await claim(), null);
    await run("cancel", { id: batch });
    const state = await run("get", { id: batch });
    assert.deepEqual(state.items.map((item) => item.state), ["running", "canceled"]);
    assert.equal((await run("get_item", { id: batch, item_id: first })).authorization, undefined);
    const finish = async (lease) => (await f.db.query("select finish_developer_batch_v1($1,$2,$3,$4,$5) result", [
      f.account.projectId, batch, first, lease, null,
    ])).rows[0].result;
    assert.equal(await finish(id(99)), false);
    assert.equal(await finish(claimed.item.lease_token), true);
    assert.equal((await run("get_item", { id: batch, item_id: first })).state, "uncertain");
    assert.equal(await claim(), null);
    for (const role of ["anon","authenticated"])
      assert.equal((await f.db.query("select has_table_privilege($1,'developer_batch_items_v1','select') allowed", [role])).rows[0].allowed, false);
    assert.equal((await f.db.query("select count(*)::int n from developer_batch_export_records_v1")).rows[0].n, 2);
  } finally {
    await f.db.close();
  }
});
