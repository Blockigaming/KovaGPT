import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import {
  validatePricingProposal,
  canonicalPricingJson,
  pricingRegistryIds,
  validateCreditOfferProposal,
  verifyCreditOfferPrice,
} from "../../src/lib/pricing/pricing-administration.mjs";
const ADMIN = "11111111-1111-4111-8111-111111111111",
  ID = "22222222-2222-4222-8222-222222222222";
const hash = (text) => createHash("sha256").update(text).digest("hex");
function proposal() {
  const effective = new Date(Date.now() - 1000).toISOString(),
    expiry = new Date(Date.now() + 86400000).toISOString();
  return {
    version: {
      version: 1,
      currency: "USD",
      margin_floor: 0.5,
      risk_buffer_percentage: 0.1,
      minimum_request_charge: 1,
      rounding_increment: 0.001,
      allowance_configuration: {
        fixed: { infrastructure: 0.01 },
        percentages: { retries: 0.05 },
        collectionPercentage: 0.03,
        collectionFixed: 0.01,
      },
      effective_at: effective,
      expires_at: expiry,
      public_price_configuration: {
        contracts: [
          {
            provider: "azure_openai",
            upstreamModel: "test-deployment",
            publicModel: "test-model",
            capability: "chat",
            meter: "responses_tokens",
            maximumUsage: { input_tokens: 10000, cached_input_tokens: 10000, output_tokens: 1000 },
            maximumRequestBytes: 10000,
            expectedResponseModels: ["test-response-model"],
          },
        ],
      },
    },
    registry: ["input_tokens", "cached_input_tokens", "output_tokens"].map((dimension) => ({
      provider: "azure_openai",
      upstream_model: "test-deployment",
      billing_dimension: dimension,
      unit: "tokens",
      unit_quantity: 1000,
      unit_price: 2,
      currency: "USD",
      source: "Executable fixture only; never commercial configuration",
      effective_at: effective,
      expires_at: expiry,
      evidence: {
        reference: "test-fixture-evidence",
        sha256: "a".repeat(64),
        verifiedAt: new Date(Date.now() - 60000).toISOString(),
      },
    })),
  };
}
function offer() {
  return {
    name: "Fixture",
    environment: "sandbox",
    stripe_price_id: "price_fixture",
    currency: "USD",
    subtotal_amount: 1000,
    credits_amount: 800,
    refund_reserve: 50,
    dispute_reserve: 50,
    maximum_processor_fee: 100,
    tax_mode: "automatic",
    tax_review_reference: "Fixture owner review only",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}
test("canonical review hash and bounded quote preview cover every exact registry dimension", () => {
  const p = proposal(),
    checked = validatePricingProposal(p);
  assert.equal(checked.quotes.length, 1);
  assert.ok(checked.quotes[0].maximumReservedCharge > 0);
  assert.equal(canonicalPricingJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  for (const mutate of [
    (v) => {
      v.version.margin_floor = 0.49;
    },
    (v) => {
      v.registry[0].evidence.sha256 = "missing";
    },
    (v) => {
      v.registry[0].currency = "EUR";
    },
    (v) => {
      v.registry.push(v.registry[0]);
    },
    (v) => {
      v.registry.pop();
    },
    (v) => {
      v.version.expires_at = new Date(Date.now() - 1).toISOString();
    },
    (v) => {
      v.version.allowance_configuration.collectionPercentage = 0.6;
    },
    (v) => {
      v.version.public_price_configuration.contracts.push(
        v.version.public_price_configuration.contracts[0],
      );
    },
    (v) => {
      v.version.public_price_configuration.contracts[0].maximumUsage.input_tokens = 1;
    },
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(() => validatePricingProposal(changed), /pricing_admin_/);
  }
});
test("version rate selection requires bounded unique immutable registry IDs", () => {
  assert.deepEqual(pricingRegistryIds({ public_price_configuration: { registryIds: [ID] } }), [ID]);
  for (const registryIds of [undefined, [], [ID, ID], ["forged"], Array(257).fill(ID)])
    assert.throws(
      () => pricingRegistryIds({ public_price_configuration: { registryIds } }),
      /binding_required/,
    );
});
test("prepaid offer approval checks explicit bounds, exact Stripe environment and automatic tax readiness", () => {
  const o = offer();
  validateCreditOfferProposal(o);
  validateCreditOfferProposal({ ...o, credits_amount: 1000 });
  assert.throws(() => validateCreditOfferProposal({ ...o, credits_amount: 1001 }), /budget/);
  const p = {
    id: o.stripe_price_id,
    active: true,
    livemode: false,
    type: "one_time",
    billing_scheme: "per_unit",
    currency: "usd",
    unit_amount: 1000,
    tax_behavior: "exclusive",
    product: { active: true, livemode: false, tax_code: "fixture_tax_code" },
  };
  const registrations = [
      { status: "active", livemode: false, active_from: Math.floor(Date.now() / 1000) - 1 },
    ],
    settings = { status: "active", livemode: false };
  verifyCreditOfferPrice(o, p, registrations, settings, { default_currency: "usd" });
  for (const changed of [
    { ...p, livemode: true },
    { ...p, unit_amount: 999 },
    { ...p, type: "recurring" },
    { ...p, tax_behavior: "inclusive" },
    { ...p, product: { active: false } },
  ])
    assert.throws(() => verifyCreditOfferPrice(o, changed, registrations, settings));
  assert.throws(
    () => verifyCreditOfferPrice(o, p, [], settings, { default_currency: "usd" }),
    /readiness/,
  );
  assert.throws(
    () =>
      verifyCreditOfferPrice(
        o,
        p,
        registrations,
        { status: "pending", livemode: false },
        { default_currency: "usd" },
      ),
    /readiness/,
  );
});
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema kova_private;create table auth.users(id uuid primary key,deleted_at timestamptz);
    create function kova_private.auth_user_exists(uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=$1 and deleted_at is null)$$;
    revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
    create table account_deletion_fences(user_id uuid primary key);grant select on account_deletion_fences to service_role;
    create table developer_credit_offers(id uuid primary key default gen_random_uuid(),name text,environment text,stripe_price_id text,currency text,subtotal_amount bigint,credits_amount bigint,refund_reserve bigint,dispute_reserve bigint,maximum_processor_fee bigint,tax_mode text,tax_review_reference text,approved_by uuid,approved_at timestamptz,expires_at timestamptz,active boolean);
    grant select,insert,update on developer_credit_offers to service_role;`);
  await db.query("insert into auth.users(id) values($1)", [ADMIN]);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260803143000_developer_api_profit_protection.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260905022817_pricing_administration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}
async function save(db, p, revision = 0, previous = null, kind = "pricing") {
  const canonical = canonicalPricingJson(p);
  return (
    await db.query(
      "select to_jsonb(public.save_developer_pricing_draft($1,$2,$3,$4,$5,$6,$7)) draft",
      [ADMIN, ID, kind, revision, previous, canonical, hash(canonical)],
    )
  ).rows[0].draft;
}
async function approve(db, d) {
  return (
    await db.query("select to_jsonb(public.approve_developer_pricing_draft($1,$2,$3,$4)) draft", [
      ADMIN,
      ID,
      d.revision,
      d.payload_hash,
    ])
  ).rows[0].draft;
}
test("real SQL draft CAS and approval reject stale hashes and publish immutable exact rates only once", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    const p = proposal(),
      first = await save(db, p);
    assert.equal((await save(db, p)).revision, 1);
    p.version.margin_floor = 0.55;
    const second = await save(db, p, 1, first.payload_hash);
    await assert.rejects(approve(db, first), /draft_conflict/);
    await assert.rejects(save(db, proposal(), 1, first.payload_hash), /draft_conflict/);
    const approved = await approve(db, second);
    assert.equal((await approve(db, second)).result_id, approved.result_id);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from developer_pricing_draft_export_rows where owner_id=$1",
          [ADMIN],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from developer_pricing_event_export_rows where owner_id=$1",
          [ADMIN],
        )
      ).rows[0].n,
      3,
    );
    const version = (await db.query("select * from api_pricing_versions")).rows[0];
    assert.equal(version.margin_floor, "0.55000");
    assert.equal(pricingRegistryIds(version).length, 3);
    assert.equal(version.public_price_configuration.administrationHash, second.payload_hash);
    assert.equal(
      (await db.query("select count(*)::int n from upstream_price_registry")).rows[0].n,
      3,
    );
    await assert.rejects(db.exec("update api_pricing_versions set margin_floor=.6"), /immutable/);
    await assert.rejects(db.exec("update upstream_price_registry set unit_price=999"), /immutable/);
    await assert.rejects(save(db, p, 2, second.payload_hash), /immutable/);
    await db.query(
      "select public.retire_developer_pricing_draft($1,$2,$3,$4,'Owner retired these reviewed terms')",
      [ADMIN, ID, second.revision, second.payload_hash],
    );
    assert.equal(
      (await db.query("select status from api_pricing_versions")).rows[0].status,
      "retired",
    );
    assert.equal(
      (await db.query("select count(*)::int n from upstream_price_registry where active")).rows[0]
        .n,
      0,
    );
    await assert.rejects(db.exec("update api_pricing_versions set status='approved'"), /immutable/);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(save(db, p), /permission denied/);
    await assert.rejects(db.exec("select * from developer_pricing_drafts"), /permission denied/);
    await assert.rejects(
      db.exec("select * from developer_pricing_draft_export_rows"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("real SQL approval fails closed on deletion, expired terms and changed canonical bytes", async () => {
  const db = await database();
  try {
    const d = await save(db, proposal());
    await db.query("insert into account_deletion_fences values($1)", [ADMIN]);
    await assert.rejects(approve(db, d), /account_unavailable/);
    await db.exec("delete from account_deletion_fences");
    await assert.rejects(
      db.query("update developer_pricing_drafts set canonical_payload=$1 where id=$2", [
        canonicalPricingJson(offer()),
        ID,
      ]),
      /check constraint/,
    );
    const p = proposal();
    p.version.expires_at = new Date(Date.now() - 1).toISOString();
    const expired = await save(db, p, d.revision, d.payload_hash);
    await assert.rejects(approve(db, expired), /terms_invalid/);
    assert.equal((await db.query("select count(*)::int n from api_pricing_versions")).rows[0].n, 0);
    const o = await save(db, offer(), expired.revision, expired.payload_hash, "credit_offer").catch(
      (e) => e,
    );
    assert.match(o.message, /immutable/);
  } finally {
    await db.close();
  }
});
test("real SQL credit-offer approval uses the reviewed payload and retirement never changes purchased terms", async () => {
  const db = await database();
  try {
    const d = await save(db, offer(), 0, null, "credit_offer"),
      a = await approve(db, d);
    assert.equal((await approve(db, d)).result_id, a.result_id);
    assert.equal(
      (await db.query("select credits_amount from developer_credit_offers")).rows[0].credits_amount,
      800,
    );
    await db.query(
      "select public.retire_developer_pricing_draft($1,$2,$3,$4,'Replace expired owner offer')",
      [ADMIN, ID, d.revision, d.payload_hash],
    );
    const row = (await db.query("select * from developer_credit_offers")).rows[0];
    assert.equal(row.active, false);
    assert.equal(row.credits_amount, 800);
  } finally {
    await db.close();
  }
});

test("Auth erasure preserves immutable commercial evidence and removes active approval attribution", async () => {
  const db = await database();
  try {
    const draft = await save(db, proposal());
    await approve(db, draft);
    const before = (await db.query("select * from api_pricing_versions")).rows[0];
    await db.query("delete from auth.users where id=$1", [ADMIN]);
    const after = (await db.query("select * from api_pricing_versions")).rows[0];
    assert.deepEqual(after, { ...before, approved_by: null });
    assert.equal(
      (await db.query("select count(*)::int n from upstream_price_registry where verifier is null"))
        .rows[0].n,
      3,
    );
    await assert.rejects(save(db, proposal()), /account_unavailable/);
  } finally {
    await db.close();
  }
});

test("every pricing mutation takes the account fence lock before checking account availability", async () => {
  const source = await readFile(
    new URL("../../supabase/migrations/20260905022817_pricing_administration.sql", import.meta.url),
    "utf8",
  );
  for (const name of [
    "save_developer_pricing_draft",
    "approve_developer_pricing_draft",
    "retire_developer_pricing_draft",
  ]) {
    const start = source.indexOf(`create function public.${name}`),
      end = source.indexOf("end $$;", start);
    const body = source.slice(start, end);
    assert.ok(
      body.indexOf("hashtextextended(p_admin::text,20260903204500)") <
        body.indexOf("auth_user_exists(p_admin)"),
    );
    assert.match(body, /hashtextextended\(p_admin::text,20260903204500\)/);
  }
});

async function apiFixture() {
  const canonical = canonicalPricingJson(proposal());
  const state = {
    reads: 0,
    writes: [],
    draft: {
      id: ID,
      kind: "pricing",
      revision: 1,
      payload_hash: hash(canonical),
      canonical_payload: canonical,
      status: "draft",
    },
  };
  const db = {
    from() {
      state.reads++;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        abortSignal() {
          return q;
        },
        async maybeSingle() {
          return { data: state.draft };
        },
      };
      return q;
    },
    async rpc(name, args) {
      state.writes.push({ name, args });
      return { data: { ...state.draft, status: "approved" } };
    },
  };
  state.authorization = { caller: { userId: ADMIN, supabaseAdmin: db } };
  const key = `pricing-admin-api-${crypto.randomUUID()}`;
  globalThis[key] = state;
  let source = ts.transpileModule(
    await readFile(
      new URL("../../src/lib/pricing/pricing-administration.server.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "node:crypto") return full;
    if (path === "./pricing-administration.mjs")
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(
          new URL("../../src/lib/pricing/pricing-administration.mjs", import.meta.url).href,
        ),
      );
    if (path === "@/lib/bounded-json.server.mjs")
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(new URL("../../src/lib/bounded-json.server.mjs", import.meta.url).href),
      );
    if (path === "@/lib/administrator.server")
      return `const requireAdministrator=async()=>globalThis[${JSON.stringify(key)}].authorization;`;
    if (path === "@/lib/api-auth.server") return "const assertNotBanned=async()=>null;";
    if (path === "@/lib/auth-security.mjs") return "const isCrossSiteMutation=()=>false;";
    if (path === "@/lib/distributed-rate-limit.server")
      return "const consumeApplicationRateLimit=async()=>({allowed:true});";
    if (path === "./developer-offer-verification.server")
      return "const verifyConfiguredCreditOffer=async()=>{};";
    throw new Error(`Unexpected test dependency ${path}`);
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source + `\n//${key}`).toString("base64")}`
  );
  return {
    state,
    handle: module.handlePricingAdministration,
    dispose: () => delete globalThis[key],
  };
}
test("production administration API rejects changed principals and unreviewed or stale approvals before mutation", async () => {
  const f = await apiFixture();
  try {
    const request = (body, owner = ADMIN) =>
      new Request("https://app.invalid/api/admin/pricing", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kova-Expected-User": owner },
        body: JSON.stringify(body),
      });
    const d = f.state.draft,
      body = {
        operation: "approve",
        id: ID,
        revision: 1,
        hash: d.payload_hash,
        reviewedHash: d.payload_hash,
      };
    assert.equal((await f.handle(request(body, ID))).status, 409);
    assert.equal(f.state.reads, 0);
    assert.equal((await f.handle(request({ ...body, reviewedHash: null }))).status, 400);
    assert.equal((await f.handle(request({ ...body, revision: 2 }))).status, 409);
    assert.equal(f.state.writes.length, 0);
    assert.equal((await f.handle(request(body))).status, 200);
    assert.equal(f.state.writes.length, 1);
    assert.deepEqual(f.state.writes[0].args, {
      p_admin: ADMIN,
      p_id: ID,
      p_revision: 1,
      p_hash: d.payload_hash,
    });
    f.state.authorization = { response: new Response(null, { status: 403 }) };
    assert.equal((await f.handle(request(body))).status, 403);
    assert.equal(f.state.writes.length, 1);
  } finally {
    f.dispose();
  }
});
