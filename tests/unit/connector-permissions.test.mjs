import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as google from "../../src/lib/google-account-policy.mjs";

const owner = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";

function fixture(scope, enabled = false, ownsAccount = true) {
  const requests = [];
  const access = [];
  const row = {
    id: target,
    provider_id: "microsoft",
    status: "connected",
    account_label: "Fixture",
    granted_scopes: [scope],
    deleted_at: null,
    token_expires_at: null,
    updated_at: "first",
    access_token_ciphertext: "ciphertext",
  };
  let authenticatedOwner;
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "integration_linked_accounts");
      const predicates = {};
      const query = {
        select: () => query,
        eq: (field, value) => {
          predicates[field] = value;
          return query;
        },
        is: () => query,
        maybeSingle: () => {
          assert.equal(predicates.owner_id, owner);
          assert.equal(predicates.id, target);
          assert.equal(predicates.provider_id, "microsoft");
          return { data: ownsAccount ? row : null, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "@tanstack/react-start": {
      createServerFn() {
        let validator;
        const builder = {
          middleware: () => builder,
          inputValidator(schema) {
            validator = schema;
            return builder;
          },
          handler: (fn) => (data) =>
            fn({ data: validator.parse(data), context: { userId: owner } }),
        };
        return builder;
      },
    },
    zod: { z },
    "@/integrations/supabase/auth-middleware": {},
    "@/integrations/supabase/client.server": { supabaseAdmin },
    "@/lib/google-oauth.server": {},
    "@/lib/google-account-policy.mjs": google,
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async (_db, id) => {
        authenticatedOwner = id;
      },
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/integrations/credential-vault.server": { decryptCredential: async () => "fixture-token" },
    "@/integrations/connection-flows.mjs": flows,
    "@/integrations/oauth-providers.server": {
      configuredOAuthProviders: () => [{ id: "microsoft" }],
    },
    "@/lib/connector-write-policy.server": {
      connectorWriteAllowed: async (...args) => {
        access.push(args);
        return enabled;
      },
      saveConnectorWritePreference: async (_owner, _connector, _target, next) => {
        enabled = next;
      },
    },
  };
  const source = ts.transpileModule(readFileSync("src/lib/connector-write.functions.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const handlers = {};
  new Function("exports", "require", "fetch", source)(
    handlers,
    (id) => {
      assert.ok(Object.hasOwn(dependencies, id), id);
      return dependencies[id];
    },
    async (url, options) => {
      assert.equal(authenticatedOwner, owner);
      requests.push([url, options]);
      return new Response(null, { status: 201 });
    },
  );
  return { handlers, requests, access, row };
}

test("read-only Google consent does not ask for Gmail compose or Calendar event writes", () => {
  for (const connector of ["gmail", "google-calendar"]) {
    const scopes = google.googleConnectorScopes(connector, "read");
    assert.equal(
      google.hasGoogleCapability(scopes, connector === "gmail" ? "gmail.read" : "calendar.read"),
      true,
    );
    assert.equal(
      google.hasGoogleCapability(scopes, connector === "gmail" ? "gmail.write" : "calendar.write"),
      false,
    );
  }
});

test("database keeps connector preference and private submission records server-only", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${owner}');
    `);
    await db.exec(
      readFileSync(
        "supabase/migrations/20261123084000_kova_connector_controls_and_submissions.sql",
        "utf8",
      ),
    );
    await db.exec("set role service_role");
    await db.query(
      "insert into public.connector_write_preferences(owner_id, connector, target_id) values ($1,'outlook',$2)",
      [owner, target],
    );
    await db.query(
      "insert into public.connector_directory_submissions(owner_id, details) values ($1,'{}')",
      [owner],
    );
    assert.equal(
      (await db.query("select allows_write from public.connector_write_preferences")).rows[0]
        .allows_write,
      false,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from public.connector_directory_submissions"),
      /permission denied/u,
    );
    await assert.rejects(
      db.query("update public.connector_write_preferences set allows_write = true"),
      /permission denied/u,
    );
    await db.exec("reset role");
    await db.query("delete from auth.users where id = $1", [owner]);
    for (const table of ["connector_write_preferences", "connector_directory_submissions"])
      assert.deepEqual((await db.query(`select owner_id from public.${table}`)).rows, []);
  } finally {
    await db.close();
  }
});

test("OneDrive cannot write until the owner enables it even with provider write scope", async () => {
  const { handlers, requests, access } = fixture("Files.ReadWrite");
  const data = { target, name: "Fixture folder" };
  assert.match((await handlers.createOneDriveFolder(data)).error, /Write access changed/u);
  assert.equal(requests.length, 0);
  assert.deepEqual(
    await handlers.setConnectorWriteAccess({
      subject: { target, connector: "onedrive" },
      enabled: true,
    }),
    { enabled: true },
  );
  assert.deepEqual(await handlers.createOneDriveFolder(data), { created: true });
  assert.deepEqual(access.at(-1), [owner, "onedrive", target]);
  assert.equal(requests[0][0], "https://graph.microsoft.com/v1.0/me/drive/root/children");
  assert.equal(JSON.parse(requests[0][1].body)["@microsoft.graph.conflictBehavior"], "fail");
  await handlers.setConnectorWriteAccess({
    subject: { target, connector: "onedrive" },
    enabled: false,
  });
  assert.match((await handlers.createOneDriveFolder(data)).error, /Write access changed/u);
  assert.equal(requests.length, 1);
});

test("Outlook writes only plain-text drafts for an owned account with both access grants", async () => {
  const data = {
    target,
    recipient: "test@example.com",
    subject: "Fixture subject",
    body: "Fixture body",
  };
  for (const [scope, owned] of [
    ["Mail.Read", true],
    ["Mail.ReadWrite", false],
  ]) {
    const { handlers, requests } = fixture(scope, true, owned);
    assert.match((await handlers.createOutlookDraft(data)).error, /write permission/u);
    assert.equal(requests.length, 0);
  }
  const { handlers, requests } = fixture("Mail.ReadWrite", true);
  assert.deepEqual(await handlers.createOutlookDraft(data), { created: true });
  assert.equal(requests[0][0], "https://graph.microsoft.com/v1.0/me/messages");
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    subject: data.subject,
    body: { contentType: "Text", content: data.body },
    toRecipients: [{ emailAddress: { address: data.recipient } }],
  });
});
