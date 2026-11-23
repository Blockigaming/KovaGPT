import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as google from "../../src/lib/google-account-policy.mjs";
import * as providerResponse from "../../src/lib/provider-response.server.mjs";
import * as keyCredential from "../../src/integrations/key-connection-credential.server.mjs";
import * as salesforceCredential from "../../src/integrations/salesforce-credential.server.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const owner = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const actions = loadUiModule("src/lib/connector-write-actions.ts", {
  "@/integrations/connection-flows.mjs": flows,
});
const writeRequests = loadUiModule(
  "src/lib/connector-write-requests.server.ts",
  {
    "./connector-write-actions": actions,
    "@/integrations/salesforce-credential.server.mjs": salesforceCredential,
  },
  { URL },
);

function fixture(
  scope,
  enabled = false,
  ownsAccount = true,
  provider = "microsoft",
  { scopes, response, credential = "fixture-token" } = {},
) {
  const requests = [];
  const access = [];
  const row = {
    id: target,
    provider_id: provider,
    status: "connected",
    account_label: "Fixture",
    granted_scopes: scopes ?? (provider === "linear" ? ["read", scope] : [scope]),
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
          assert.equal(predicates.provider_id, provider);
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
    "@/lib/google-oauth.server": {
      getGoogleConnection: async () => ({ scopes: scope }),
      getGoogleExecutionBinding: async (id, account) => {
        assert.equal(id, owner);
        assert.equal(account, target);
        return {
          connectionId: target,
          grantId: row.updated_at,
          expectedGoogleSub: "google-fixture",
        };
      },
      getValidGoogleAccessToken: async (_id, binding) => {
        if (!google.hasGoogleCapability(scope, binding.capability))
          throw new Error("write scope required");
        return "fixture-token";
      },
    },
    "@/lib/google-account-policy.mjs": google,
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async (_db, id) => {
        authenticatedOwner = id;
      },
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/integrations/credential-vault.server": { decryptCredential: async () => credential },
    "@/integrations/connection-flows.mjs": flows,
    "@/integrations/oauth-providers.server": {
      configuredOAuthProviders: () => [{ id: provider }],
      configuredKeyProviders: () => [{ id: provider }],
    },
    "@/integrations/key-connection-credential.server.mjs": keyCredential,
    "@/integrations/salesforce-credential.server.mjs": salesforceCredential,
    "@/lib/connector-write-actions": actions,
    "@/lib/connector-write-requests.server": writeRequests,
    "@/lib/provider-response.server.mjs": providerResponse,
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
      if (response) return response();
      if (provider === "linear")
        return Response.json({ data: { issueCreate: { success: true, issue: { id: target } } } });
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
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        "supabase/migrations/20261123143000_kova_connector_drive_calendar_write.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync("supabase/migrations/20261123150000_kova_connector_linear_write.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261123194500_kova_expand_reviewed_connector_writes.sql",
        "utf8",
      ),
    );
    await db.exec("set role service_role");
    await db.query(
      "insert into public.connector_write_preferences(owner_id, connector, target_id) values ($1,'google-drive',$2), ($1,'outlook-calendar',$2), ($1,'linear',$2)",
      [owner, target],
    );
    for (const connector of actions.EXTRA_WRITE_CONNECTORS)
      await db.query(
        "insert into public.connector_write_preferences(owner_id, connector, target_id) values ($1,$2,$3)",
        [owner, connector, target],
      );
    await assert.rejects(
      db.query(
        "insert into public.connector_write_preferences(owner_id, connector, target_id) values ($1,'unknown',$2)",
        [owner, target],
      ),
      /check constraint/u,
    );
    await db.query(
      "insert into public.connector_directory_submissions(owner_id, details) values ($1,'{}')",
      [owner],
    );
    const preferences = await db.query(
      "select allows_write from public.connector_write_preferences",
    );
    assert.equal(preferences.rows.length, actions.EXTRA_WRITE_CONNECTORS.length + 3);
    assert.ok(preferences.rows.every(({ allows_write }) => allows_write === false));
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

test("Slack requires a confirmed action, owned grant and opt-in, and checks the API receipt", async () => {
  const connector = "slack";
  const destination = "C0123456789";
  const fields = { destination, text: "Fixture review" };
  const data = { connector, target, confirmed: true, fields };
  const settings = { subject: { connector, target }, enabled: true };
  const scopes = ["search:read", "chat:write"];
  for (const f of [
    fixture("search:read", true, true, connector),
    fixture("chat:write", true, false, connector, { scopes }),
  ]) {
    assert.match((await f.handlers.runConnectorWriteAction(data)).error, /permission/u);
    assert.equal(f.requests.length, 0);
  }
  let result = { ok: false };
  const f = fixture("chat:write", false, true, connector, {
    scopes,
    response: () => Response.json(result),
  });
  assert.match((await f.handlers.runConnectorWriteAction(data)).error, /Write access changed/u);
  assert.deepEqual(await f.handlers.setConnectorWriteAccess(settings), { enabled: true });
  assert.throws(() => f.handlers.runConnectorWriteAction({ ...data, confirmed: false }));
  assert.match(
    (
      await f.handlers.runConnectorWriteAction({
        ...data,
        fields: { ...fields, url: "https://example.org" },
      })
    ).error,
    /Review the action fields/u,
  );
  assert.equal(f.requests.length, 0);
  assert.match((await f.handlers.runConnectorWriteAction(data)).error, /did not confirm/u);
  assert.equal(f.requests.length, 1);
  result = { ok: true, channel: destination, ts: "1234567890.123456" };
  assert.deepEqual(await f.handlers.runConnectorWriteAction(data), { ok: true });
  const [url, request] = f.requests.at(-1);
  assert.equal(url, "https://slack.com/api/chat.postMessage");
  assert.equal(request.redirect, "error");
  assert.deepEqual(JSON.parse(request.body), {
    channel: destination,
    text: fields.text,
    mrkdwn: false,
    unfurl_links: false,
    unfurl_media: false,
  });
  await f.handlers.setConnectorWriteAccess({ ...settings, enabled: false });
  assert.match((await f.handlers.runConnectorWriteAction(data)).error, /Write access changed/u);
  assert.equal(f.requests.length, 2);
});

test("Notion internal writes use only the page bound to the linked credential", async () => {
  const pageId = owner;
  const credential = keyCredential.prepareKeyCredential("notion-private", {
    apiKey: "ntn_fixture-token",
    pageId,
  }).token;
  const connector = "notion-private";
  const f = fixture("page:read", true, true, connector, {
    credential,
    response: () => Response.json({ object: "list", results: [{ id: target, type: "paragraph" }] }),
  });
  const data = { connector, target, confirmed: true, fields: { text: "Fixture paragraph" } };
  assert.match(
    (
      await f.handlers.runConnectorWriteAction({
        ...data,
        fields: { ...data.fields, destination: target },
      })
    ).error,
    /Review the action fields/u,
  );
  assert.deepEqual(await f.handlers.runConnectorWriteAction(data), { ok: true });
  const [url, request] = f.requests[0];
  assert.equal(url, `https://api.notion.com/v1/blocks/${pageId}/children`);
  assert.equal(request.method, "PATCH");
  assert.equal(request.headers.Authorization, "Bearer ntn_fixture-token");
});

test("every new directory action builds a bounded request and validates a provider receipt", () => {
  const calendlyEvent = "https://api.calendly.com/event_types/AAAAAAAAAAAAAAAA";
  const notionReceipt = { object: "list", results: [{ id: target, type: "paragraph" }] };
  const receipts = {
    box: [{ title: "Folder" }, "api.box.com", "/2.0/folders", 201, { id: "321" }],
    calendly: [
      { destination: calendlyEvent },
      "api.calendly.com",
      "/scheduling_links",
      201,
      { resource: { owner: calendlyEvent, booking_url: "https://calendly.com/d/fixture" } },
    ],
    canva: [
      { title: "Design" },
      "api.canva.com",
      "/rest/v1/designs",
      200,
      { design: { id: "ABC" } },
    ],
    figma: [
      { destination: "File123", text: "Comment" },
      "api.figma.com",
      "/v1/files/File123/comments",
      200,
      { id: "123" },
    ],
    "google-bigquery": [
      { destination: "project-fixture", title: "dataset_1", location: "US" },
      "bigquery.googleapis.com",
      "/bigquery/v2/projects/project-fixture/datasets",
      200,
      { datasetReference: { projectId: "project-fixture", datasetId: "dataset_1" } },
    ],
    hubspot: [
      { title: "Company" },
      "api.hubapi.com",
      "/crm/v3/objects/companies",
      201,
      { id: "111" },
    ],
    "ms-teams": [
      { destination: "19:team@thread.v2", text: "Message" },
      "graph.microsoft.com",
      "/v1.0/chats/19%3Ateam%40thread.v2/messages",
      201,
      { id: "111" },
    ],
    notion: [
      { destination: target, text: "Paragraph" },
      "api.notion.com",
      `/v1/blocks/${target}/children`,
      200,
      notionReceipt,
    ],
    "notion-private": [
      { text: "Paragraph" },
      "api.notion.com",
      `/v1/blocks/${owner}/children`,
      200,
      notionReceipt,
    ],
    salesforce: [
      { title: "Account" },
      "fixtures.my.salesforce.com",
      "/services/data/v67.0/sobjects/Account/",
      201,
      { id: "001000000000001", success: true },
    ],
    sharepoint: [
      { destination: `example.sharepoint.com,${owner},${target}`, listId: target, title: "Item" },
      "graph.microsoft.com",
      `/v1.0/sites/example.sharepoint.com%2C${owner}%2C${target}/lists/${target}/items`,
      201,
      { id: "111" },
    ],
    slack: [
      { destination: "C0123456789", text: "Message" },
      "slack.com",
      "/api/chat.postMessage",
      200,
      { ok: true, channel: "C0123456789", ts: "1234567890.123456" },
    ],
    vercel: [
      { title: "fixture-project" },
      "api.vercel.com",
      "/v11/projects?teamId=team_fixture",
      200,
      { accountId: "team_fixture", id: "prj_fixture", name: "fixture-project" },
    ],
  };
  assert.deepEqual([...actions.EXTRA_WRITE_CONNECTORS].sort(), Object.keys(receipts).sort());
  for (const [connector, [fields, host, path, status, receipt]] of Object.entries(receipts)) {
    const request = writeRequests.connectorWriteRequest(connector, fields, {
      notionPageId: owner,
      salesforceQuery: "https://fixtures.my.salesforce.com/services/data/v67.0/query",
      vercelTeamId: "team_fixture",
    });
    assert.equal(request.url, `https://${host}${path}`, connector);
    assert.equal(request.status, status, connector);
    assert.equal(request.confirmed(receipt), true, connector);
    assert.equal(request.confirmed({}), false, connector);
    assert.equal(writeRequests.connectorWriteRequest(connector, { ...fields, extra: "x" }), null);
  }
  assert.equal(
    writeRequests.connectorWriteRequest("calendly", {
      destination: "https://example.test/event_types/AAAAAAAAAAAAAAAA",
    }),
    null,
  );
  assert.throws(
    () =>
      writeRequests.connectorWriteRequest(
        "salesforce",
        { title: "Account" },
        {
          salesforceQuery: "https://example.test/services/data/v67.0/query",
        },
      ),
    /invalid_salesforce_binding/u,
  );
});

test("Linear writes require the provider scope, owned account, and a reviewed issue", async () => {
  const data = {
    target,
    teamId: "00000000-0000-4000-8000-000000000003",
    title: "Fixture issue",
    description: "Fixture description",
    confirmed: true,
  };
  const settings = { subject: { target, connector: "linear" }, enabled: true };
  for (const [scope, owned] of [
    ["read", true],
    ["issues:create", false],
  ]) {
    const { handlers, requests } = fixture(scope, true, owned, "linear");
    assert.match((await handlers.setConnectorWriteAccess(settings)).error, /Authorize/u);
    assert.match((await handlers.createLinearIssue(data)).error, /write permission/u);
    assert.equal(requests.length, 0);
  }
  const { handlers, requests } = fixture("issues:create", false, true, "linear");
  assert.match((await handlers.createLinearIssue(data)).error, /Write access changed/u);
  assert.deepEqual(await handlers.setConnectorWriteAccess(settings), { enabled: true });
  assert.throws(() => handlers.createLinearIssue({ ...data, confirmed: false }));
  assert.equal(requests.length, 0);
  assert.deepEqual(await handlers.createLinearIssue(data), { created: true });
  assert.equal(requests[0][0], "https://api.linear.app/graphql");
  assert.equal(requests[0][1].redirect, "error");
  assert.deepEqual(JSON.parse(requests[0][1].body).variables.input, {
    teamId: data.teamId,
    title: data.title,
    description: data.description,
  });
  await handlers.setConnectorWriteAccess({ ...settings, enabled: false });
  assert.match((await handlers.createLinearIssue(data)).error, /Write access changed/u);
  assert.equal(requests.length, 1);
  assert.equal(flows.hasConnectionScopes(["read", "write"], ["issues:create"]), true);
});

test("Google Drive requests per-file write consent only when explicitly enabled", async () => {
  const readScopes = google.googleConnectorScopes("google-drive");
  assert.equal(google.hasGoogleCapability(readScopes, "drive.read"), true);
  assert.equal(google.hasGoogleCapability(readScopes, "drive.write"), false);
  const fixtureAccount = fixture(google.googleConnectorScopes("google-drive", "read-write"));
  const { handlers, requests } = fixtureAccount;
  const folder = { target, name: "Fixture folder" };
  assert.match((await handlers.createGoogleDriveFolder(folder)).error, /Enable Google Drive/u);
  assert.equal(requests.length, 0);
  await handlers.setConnectorWriteAccess({
    subject: { connector: "google-drive", target },
    enabled: true,
  });
  assert.deepEqual(await handlers.createGoogleDriveFolder(folder), { created: true });
  assert.equal(requests[0][0], "https://www.googleapis.com/drive/v3/files?fields=id");
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    name: folder.name,
    mimeType: "application/vnd.google-apps.folder",
  });
});

test("Outlook Calendar creates only a reviewed personal event using a transaction ID", async () => {
  const payload = {
    target,
    actionId: "00000000-0000-4000-8000-000000000003",
    title: "Fixture event",
    start: "2026-11-24T14:00:00Z",
    end: "2026-11-24T14:30:00Z",
  };
  const readOnly = fixture("Calendars.ReadBasic", true);
  assert.match((await readOnly.handlers.createOutlookEvent(payload)).error, /permission/u);
  assert.equal(readOnly.requests.length, 0);
  const { handlers, requests } = fixture("Calendars.ReadWrite", true);
  assert.throws(() => handlers.createOutlookEvent({ ...payload, end: payload.start }), /End time/u);
  assert.deepEqual(await handlers.createOutlookEvent(payload), { created: true });
  assert.equal(requests[0][0], "https://graph.microsoft.com/v1.0/me/calendar/events");
  const data = JSON.parse(requests[0][1].body);
  assert.equal(data.transactionId, payload.actionId);
  assert.deepEqual(data.start, { dateTime: "2026-11-24T14:00:00.000", timeZone: "UTC" });
  assert.equal(data.attendees, undefined);
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
