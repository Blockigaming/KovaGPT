import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { projectAccountExportIdentity } from "../../src/lib/account-export-identity.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const shadow = "shadow+fixture@auth.invalid.kovagpt.com";
const realEmail = "owner@example.test";

async function worker(admin) {
  let source = await readFile("src/lib/account-export.server.ts", "utf8");
  source = source.replace(
    'import { supabaseAdmin } from "@/integrations/supabase/client.server";',
    'const supabaseAdmin = globalThis[Symbol.for("kova-export-identity-test")];',
  );
  source = source.replaceAll(/"(?:@\/lib\/|\.\/)([^"\n]+)"/gu, (_, path) =>
    JSON.stringify(new URL(`../../src/lib/${path}`, import.meta.url).href),
  );
  globalThis[Symbol.for("kova-export-identity-test")] = admin;
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}#${crypto.randomUUID()}`
    );
  } finally {
    delete globalThis[Symbol.for("kova-export-identity-test")];
  }
}

test("the real account export includes the verified primary email and omits synthetic hosted identities", async () => {
  const reads = [],
    lookups = [];
  const client = createClient("https://export.example", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        reads.push(String(url));
        return Response.json([]);
      },
    },
  });
  const source = {
    id: owner,
    email: shadow,
    identities: [
      { identity_data: { email: shadow } },
      { provider: "google", identity_data: { email: realEmail } },
    ],
  };
  const admin = {
    from: client.from.bind(client),
    auth: {
      admin: {
        getUserById: async (id) => {
          assert.equal(id, owner);
          return { data: { user: source }, error: null };
        },
      },
    },
    rpc: async (name, args) => {
      lookups.push([name, args]);
      return { data: realEmail, error: null };
    },
  };
  const w = await worker(admin);
  const artifact = await w.buildAccountExport(owner, "20000000-0000-4000-8000-000000000002");
  const exported = JSON.parse(artifact.text);
  assert.equal(exported.account.id, owner);
  assert.equal(exported.account.email, realEmail);
  assert.equal(exported.account.identities.length, 1);
  assert.ok(!artifact.text.includes(shadow));
  assert.equal(source.email, shadow, "projection does not mutate the hosted record");
  assert.deepEqual(lookups, [["kova_auth_directory_email", { p_account_id: owner }]]);
  assert.ok(reads.length > 0);
});

test("missing, unverified, unavailable and malformed directory results never export the shadow email", async () => {
  for (const result of [
    null,
    { data: null },
    { data: "" },
    { data: shadow },
    { data: [realEmail] },
    { data: realEmail, error: { code: "unavailable" } },
  ]) {
    await assert.rejects(
      projectAccountExportIdentity({ rpc: async () => result }, owner, {
        id: owner,
        email: shadow,
      }),
      /account_export_user_unavailable/u,
    );
  }
  await assert.rejects(
    projectAccountExportIdentity(
      {
        rpc: async () => {
          throw new Error("offline");
        },
      },
      owner,
      { id: owner, email: shadow },
    ),
    /offline/u,
  );
  await assert.rejects(
    projectAccountExportIdentity({ rpc: () => assert.fail("no lookup for foreign owner") }, owner, {
      id: "other",
      email: realEmail,
    }),
    /account_export_user_unavailable/u,
  );
});

test("dual and pure Kova use current verified identity even when the hosted email is not a shadow", async () => {
  const saved = process.env.KOVA_AUTH_MODE;
  try {
    for (const mode of ["dual", "kova"]) {
      process.env.KOVA_AUTH_MODE = mode;
      const row = await projectAccountExportIdentity(
        { rpc: async () => ({ data: realEmail }) },
        owner,
        { id: owner, email: "old@example.test" },
      );
      assert.equal(row.email, realEmail);
    }
    process.env.KOVA_AUTH_MODE = "supabase";
    const row = { id: owner, email: realEmail };
    assert.equal(
      await projectAccountExportIdentity(
        { rpc: () => assert.fail("legacy mode needs no new schema") },
        owner,
        row,
      ),
      row,
    );
  } finally {
    if (saved === undefined) delete process.env.KOVA_AUTH_MODE;
    else process.env.KOVA_AUTH_MODE = saved;
  }
});

for (const mode of ["dual", "kova"])
  test(`${mode}: the actual export uses owned identity without any hosted Auth administration`, async () => {
    const { authDatabase, passwordAccount } = await import("../helpers/kova-auth-database.mjs");
    const db = await authDatabase();
    const previous = process.env.KOVA_AUTH_MODE;
    try {
      await passwordAccount(db, { email: realEmail });
      process.env.KOVA_AUTH_MODE = mode;
      const client = createClient("https://export.example", "fixture", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async () => Response.json([]) },
      });
      const rpcCalls = [];
      const admin = {
        from: client.from.bind(client),
        get auth() {
          assert.fail("owned export must not read hosted Auth");
        },
        rpc: async (name, args) => {
          rpcCalls.push(name);
          assert.equal(name, "kova_auth_export_identity");
          return {
            data: (
              await db.query("select public.kova_auth_export_identity($1) as value", [
                args.p_account_id,
              ])
            ).rows[0].value,
          };
        },
      };
      const w = await worker(admin);
      const artifact = await w.buildAccountExport(owner, "20000000-0000-4000-8000-000000000002");
      const account = JSON.parse(artifact.text).account;
      assert.equal(account.id, owner);
      assert.equal(account.email, realEmail);
      assert.equal(account.app_metadata.provider, "kova");
      assert.deepEqual(rpcCalls, ["kova_auth_export_identity"]);
      assert.ok(!artifact.text.includes("scrypt-v1"));
      assert.ok(!artifact.text.includes("secret_hash"));
      await db.query(
        "update kova_private.auth_accounts set suspended_until='infinity' where id=$1",
        [owner],
      );
      await assert.rejects(
        w.buildAccountExport(owner, "20000000-0000-4000-8000-000000000002"),
        /account_unavailable/,
      );
    } finally {
      if (previous === undefined) delete process.env.KOVA_AUTH_MODE;
      else process.env.KOVA_AUTH_MODE = previous;
      await db.close();
    }
  });

test("malformed or missing owned export authority never falls back to hosted Auth, and unknown private fields are not serialized", async () => {
  const { readAccountExportIdentity } = await import("../../src/lib/account-export-identity.mjs");
  const old = process.env.KOVA_AUTH_MODE;
  process.env.KOVA_AUTH_MODE = "kova";
  try {
    for (const result of [
      null,
      {},
      { data: null },
      { data: [] },
      { data: { id: owner, email: realEmail } },
      { data: null, error: { code: "outage" } },
    ]) {
      await assert.rejects(
        readAccountExportIdentity(
          {
            get auth() {
              assert.fail("no fallback");
            },
            rpc: async () => result,
          },
          owner,
        ),
        /account_export_user_unavailable/,
      );
    }
    const date = new Date().toISOString();
    const projected = await readAccountExportIdentity(
      {
        rpc: async () => ({
          data: {
            id: owner,
            email: realEmail,
            email_confirmed_at: date,
            created_at: date,
            updated_at: date,
            app_metadata: { provider: "kova", secret: "omitted" },
            user_metadata: { full_name: "Owner", secret: "omitted" },
            identities: [],
            secret_hash: "omitted",
          },
        }),
      },
      owner,
    );
    assert.ok(!JSON.stringify(projected).includes("omitted"));
  } finally {
    if (old === undefined) delete process.env.KOVA_AUTH_MODE;
    else process.env.KOVA_AUTH_MODE = old;
  }
});
