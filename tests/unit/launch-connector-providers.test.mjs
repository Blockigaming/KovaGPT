import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  LAUNCH_CONNECTORS,
  CERTIFIED_LAUNCH_CONNECTORS,
  assertLaunchCertified,
  validateOperation,
} from "../../src/integrations/launch-contracts.mjs";
import {
  authorizationUrl,
  exchangeGrant,
  providerConfig,
  revokeGrant,
} from "../../src/integrations/launch-oauth.server.mjs";
import { providerRequest } from "../../src/integrations/launch-http.server.mjs";
import { executeProviderRead } from "../../src/integrations/launch-providers.server.mjs";
const config = { clientId: "fixture-client", clientSecret: "fixture-secret" };
const grant = {
  code: "fixture-code",
  verifier: "fixture-verifier",
  redirectUri: "https://kova.example/api/callback",
};
const json = (value, status = 200) => Response.json(value, { status });
const token = (id) => ({
  accessToken: "fixture-access",
  scopes: LAUNCH_CONNECTORS[id].permissions,
  origin: id === "salesforce" ? "https://example.my.salesforce.com" : null,
});
export function identity(id) {
  if (["outlook", "onedrive", "sharepoint", "ms-teams"].includes(id))
    return { id: "ms-user", userPrincipalName: "fixture@example.test" };
  if (id === "notion") return { id: "bot-id", bot: { workspace_name: "Fixture" } };
  if (id === "linear")
    return { data: { viewer: { id: "user" }, organization: { id: "org", name: "Fixture" } } };
  if (id === "slack") return { ok: true, team_id: "T1", user_id: "U1", team: "Fixture" };
  if (id === "salesforce") return { organization_id: "org", user_id: "user" };
  return {
    active: true,
    client_id: config.clientId,
    hub_id: 123,
    user_id: 456,
    scopes: ["crm.objects.contacts.read"],
  };
}
for (const id of Object.keys(LAUNCH_CONNECTORS))
  test(`${id}: provider-specific consent, exchange, identity and scope contract`, async () => {
    const c = LAUNCH_CONNECTORS[id],
      url = new URL(authorizationUrl(id, config, { ...grant, state: "fixture-state" }));
    assert.equal(url.searchParams.get("state"), "fixture-state");
    assert.equal(url.origin, new URL(c.authorize).origin);
    assert.equal(
      url.searchParams.get(id === "slack" ? "user_scope" : "scope"),
      c.scopes.length ? c.scopes.join(id === "slack" || id === "linear" ? "," : " ") : null,
    );
    if (c.pkce)
      assert.equal(
        url.searchParams.get("code_challenge"),
        createHash("sha256").update(grant.verifier).digest("base64url"),
      );
    const calls = [];
    const result = await exchangeGrant(id, config, grant, {
      fetchImpl: async (u, init) => {
        calls.push({ u, init });
        if (calls.length === 1) {
          assert.equal(u, c.token);
          assert.equal(init.redirect, "error");
          assert.ok(init.signal);
          const payload = id === "notion" ? JSON.parse(init.body) : Object.fromEntries(init.body);
          assert.equal(payload.code, grant.code);
          assert.equal(payload.redirect_uri, grant.redirectUri);
          if (c.pkce) assert.equal(payload.code_verifier, grant.verifier);
          if (id === "slack") assert.equal(payload.client_secret, undefined);
          if (id === "notion") {
            assert.match(init.headers.Authorization, /^Basic /);
            assert.equal(init.headers["Notion-Version"], "2025-09-03");
          }
          const t = {
            access_token: "fixture-access",
            refresh_token: "fixture-refresh",
            token_type: "bearer",
            scope: c.scopes.join(" "),
            expires_in: 3600,
            ...(id === "salesforce" ? { instance_url: token(id).origin } : {}),
          };
          return json(
            id === "slack" ? { ok: true, access_token: "BOT-MUST-NOT-BE-USED", authed_user: t } : t,
          );
        }
        if (id === "hubspot") {
          assert.equal(u, "https://api.hubspot.com/oauth/v3/token/introspect");
          assert.equal(init.body.get("access_token"), "fixture-access");
          assert.ok(!u.includes("fixture-access"));
        } else assert.equal(init.headers.Authorization, "Bearer fixture-access");
        return json(identity(id));
      },
    });
    assert.equal(result.accessToken, "fixture-access");
    assert.ok(result.subject);
    assert.equal(calls.length, 2);
    assert.ok(result.expiresAt);
  });
const message = {
  id: "m1",
  subject: "Fixture",
  body: { content: "body", contentType: "text" },
  bodyPreview: "preview",
  from: { emailAddress: { address: "a@example.test" } },
  access_token: "never-return",
};
const file = {
  id: "f1",
  name: "Report",
  webUrl: "https://example.test/report",
  file: { mimeType: "text/plain" },
  "@microsoft.graph.downloadUrl": "never-return",
};
const page = {
  id: "p1",
  object: "page",
  properties: { Name: { type: "title", title: [{ plain_text: "Page" }] } },
  url: "https://notion.so/page",
};
const li = { id: "i1", title: "Issue", description: "Details", state: { name: "Todo" } };
const sf = { Id: "001000000000000AAA", Name: "Account", Industry: "Software" };
const hc = {
  id: "c1",
  properties: { firstname: "Ada", lastname: "Test", email: "ada@example.test" },
};
const cases = [
  ["outlook", "list_messages", {}, "/v1.0/me/messages", { value: [message] }, "subject", "Fixture"],
  ["outlook", "read_message", { id: "m1" }, "/v1.0/me/messages/m1", message, "text", "body"],
  [
    "onedrive",
    "list_files",
    {},
    "/v1.0/me/drive/root/children",
    { value: [file] },
    "name",
    "Report",
  ],
  ["onedrive", "get_file", { id: "f1" }, "/v1.0/me/drive/items/f1", file, "name", "Report"],
  [
    "sharepoint",
    "search_sites",
    { query: "Team" },
    "/v1.0/sites",
    { value: [{ id: "s1", displayName: "Team" }] },
    "name",
    "Team",
  ],
  [
    "sharepoint",
    "list_files",
    { siteId: "s1", folderId: "f2" },
    "/v1.0/sites/s1/drive/items/f2/children",
    { value: [file] },
    "name",
    "Report",
  ],
  [
    "sharepoint",
    "get_file",
    { siteId: "s1", id: "f1" },
    "/v1.0/sites/s1/drive/items/f1",
    file,
    "name",
    "Report",
  ],
  [
    "ms-teams",
    "list_chats",
    {},
    "/v1.0/me/chats",
    { value: [{ id: "c1", topic: "Team", chatType: "group" }] },
    "topic",
    "Team",
  ],
  [
    "ms-teams",
    "list_messages",
    { chatId: "c1" },
    "/v1.0/chats/c1/messages",
    { value: [{ id: "m1", body: { content: "Hello" } }] },
    "text",
    "Hello",
  ],
  ["notion", "search", { query: "Page" }, "/v1/search", { results: [page] }, "title", "Page"],
  ["notion", "get_page", { id: "p1" }, "/v1/pages/p1", page, "title", "Page"],
  [
    "notion",
    "list_blocks",
    { id: "p1" },
    "/v1/blocks/p1/children",
    {
      results: [
        {
          id: "b1",
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Body" }] },
          has_children: true,
        },
      ],
    },
    "text",
    "Body",
  ],
  [
    "linear",
    "list_issues",
    {},
    "/graphql",
    { data: { issues: { nodes: [li], pageInfo: { hasNextPage: false } } } },
    "title",
    "Issue",
  ],
  [
    "linear",
    "get_issue",
    { id: "i1" },
    "/graphql",
    { data: { issue: li } },
    "description",
    "Details",
  ],
  [
    "slack",
    "search_messages",
    { query: "from:me report" },
    "/api/search.messages",
    {
      ok: true,
      messages: {
        matches: [{ ts: "1.2", text: "Found", channel: { id: "C1", name: "team" } }],
        paging: { pages: 1 },
      },
    },
    "text",
    "Found",
  ],
  [
    "salesforce",
    "list_accounts",
    {},
    "/services/data/v61.0/query",
    { records: [sf], done: true },
    "name",
    "Account",
  ],
  [
    "salesforce",
    "get_account",
    { id: sf.Id },
    `/services/data/v61.0/sobjects/Account/${sf.Id}`,
    sf,
    "industry",
    "Software",
  ],
  [
    "hubspot",
    "search_contacts",
    { query: "Ada" },
    "/crm/v3/objects/contacts/search",
    { results: [hc] },
    "firstName",
    "Ada",
  ],
  [
    "hubspot",
    "get_contact",
    { id: "c1" },
    "/crm/v3/objects/contacts/c1",
    hc,
    "email",
    "ada@example.test",
  ],
];
for (const [id, operation, args, path, response, key, expected] of cases)
  test(`${id}.${operation}: real request and allowlisted response`, async () => {
    let called = 0;
    const out = await executeProviderRead(id, operation, args, token(id), null, {
      fetchImpl: async (u, init) => {
        called++;
        assert.equal(new URL(u).pathname, path);
        assert.equal(init.headers.Authorization, "Bearer fixture-access");
        assert.ok(!["PUT", "PATCH", "DELETE"].includes(init.method));
        if (id === "linear") {
          assert.ok(!JSON.parse(init.body).query.includes("mutation"));
          if (args.id) assert.equal(JSON.parse(init.body).variables.id, args.id);
        }
        if (id === "salesforce" && operation === "list_accounts")
          assert.equal(
            new URL(u).searchParams.get("q"),
            "SELECT Id, Name, Industry FROM Account ORDER BY Id",
          );
        return json(response);
      },
    });
    assert.equal(called, 1);
    assert.equal(out.items[0][key], expected);
    assert.equal(out.contentIsUntrusted, true);
    assert.ok(!JSON.stringify(out).includes("never-return"));
  });
test("default inactive gate and strict operation arguments cannot be overridden", () => {
  assert.equal(CERTIFIED_LAUNCH_CONNECTORS.length, 0);
  for (const id of Object.keys(LAUNCH_CONNECTORS))
    assert.throws(() => assertLaunchCertified(id), /connector_not_certified/);
  for (const args of [
    { id: "../x" },
    { id: "x", url: "https://evil.test" },
    { id: "x", ownerId: "other" },
    { id: "x", sql: "delete" },
  ])
    assert.throws(() => validateOperation("outlook", "read_message", args), /invalid_arguments/);
  assert.throws(() => validateOperation("slack", "send_message", {}), /unsupported_operation/);
  assert.deepEqual(providerConfig("slack", { SLACK_OAUTH_CLIENT_ID: "id" }), {
    clientId: "id",
    clientSecret: "",
  });
});
test("missing initial scopes fail closed and minted tokens are revoked", async () => {
  const calls = [];
  await assert.rejects(
    exchangeGrant("linear", config, grant, {
      fetchImpl: async (u) => {
        calls.push(u);
        return json(
          calls.length === 1 ? { access_token: "a" } : calls.length === 2 ? identity("linear") : {},
        );
      },
    }),
    /permission_incomplete/,
  );
  assert.equal(calls.at(-1), "https://api.linear.app/oauth/revoke");
});
test("Slack bot-only grant and changed identity on refresh are rejected", async () => {
  await assert.rejects(
    exchangeGrant("slack", config, grant, {
      fetchImpl: async () => json({ ok: true, access_token: "bot" }),
    }),
    /oauth_access_token_missing/,
  );
  let n = 0;
  await assert.rejects(
    exchangeGrant(
      "outlook",
      config,
      { refreshToken: "r" },
      {
        fetchImpl: async () =>
          json(++n === 1 ? { access_token: "a", scope: "Mail.Read" } : identity("outlook")),
      },
      { subject: "other", origin: null, scopes: ["Mail.Read"] },
    ),
    /oauth_account_changed/,
  );
});
test("provider cursors cannot redirect credentials, and legitimate pagination is preserved", async () => {
  const transport = {
    fetchImpl: async () =>
      json({ value: [], "@odata.nextLink": "https://evil.test/v1.0/me/messages" }),
  };
  await assert.rejects(
    executeProviderRead("outlook", "list_messages", {}, token("outlook"), null, transport),
    /invalid_cursor/,
  );
  await assert.rejects(
    executeProviderRead(
      "outlook",
      "list_messages",
      {},
      token("outlook"),
      "https://graph.microsoft.com/v1.0/users/other/messages",
      transport,
    ),
    /invalid_cursor/,
  );
  const good = "https://graph.microsoft.com/v1.0/me/messages?$skip=25";
  const out = await executeProviderRead("outlook", "list_messages", {}, token("outlook"), null, {
    fetchImpl: async () => json({ value: [], "@odata.nextLink": good }),
  });
  assert.equal(out.next, good);
  await assert.rejects(
    executeProviderRead(
      "salesforce",
      "list_accounts",
      {},
      { ...token("salesforce"), origin: "https://salesforce.com.evil.test" },
      null,
      transport,
    ),
    /provider_origin_invalid/,
  );
});
test("transport bounds responses, disables redirects and strips upstream secrets", async () => {
  for (const response of [
    new Response("provider-secret", { status: 500 }),
    new Response("x".repeat(1_048_577)),
    json({ ok: false, error: "token_revoked" }),
  ]) {
    await assert.rejects(
      providerRequest("https://example.test", {}, { fetchImpl: async () => response }),
      (e) => {
        assert.ok(!e.message.includes("provider-secret"));
        return true;
      },
    );
  }
  await assert.rejects(
    providerRequest(
      "https://example.test",
      {},
      {
        fetchImpl: async () => {
          throw new Error("secret");
        },
      },
    ),
    /^ConnectorError: provider_request_failed$/,
  );
});
test("remote revocation uses narrow contracts and never broad sign-out or uninstall", async () => {
  for (const id of ["outlook", "onedrive", "sharepoint", "ms-teams", "hubspot"]) {
    const result = await revokeGrant(
      id,
      config,
      { accessToken: "a" },
      {
        fetchImpl: async () => {
          throw new Error("must not call");
        },
      },
    );
    assert.equal(result.providerRevoked, false);
  }
  for (const id of ["slack", "notion", "linear", "salesforce"]) {
    let calls = 0;
    const result = await revokeGrant(
      id,
      config,
      { accessToken: "a", refreshToken: "r" },
      {
        fetchImpl: async (u, init) => {
          calls++;
          assert.equal(init.method, "POST");
          return json(id === "slack" ? { ok: true, revoked: true } : {});
        },
      },
    );
    assert.equal(result.providerRevoked, true);
    assert.ok(calls);
  }
  const denied = await revokeGrant(
    "slack",
    config,
    { accessToken: "a" },
    { fetchImpl: async () => json({ ok: true, revoked: false }) },
  );
  assert.equal(denied.providerRevoked, false);
});
test("refresh preserves omitted scopes but rejects explicitly reduced permissions", async () => {
  const previous = {
    subject: "ms-user",
    origin: null,
    scopes: ["Mail.Read"],
    refreshToken: "old-refresh",
  };
  for (const explicit of [false, true]) {
    let n = 0;
    const action = exchangeGrant(
      "outlook",
      config,
      { refreshToken: "old-refresh" },
      {
        fetchImpl: async () =>
          json(
            ++n === 1
              ? { access_token: "new-access", ...(explicit ? { scope: "" } : {}) }
              : identity("outlook"),
          ),
      },
      previous,
    );
    if (explicit) await assert.rejects(action, /permission_incomplete/);
    else {
      const next = await action;
      assert.deepEqual(next.scopes, ["Mail.Read"]);
      assert.equal(next.refreshToken, "old-refresh");
    }
  }
});
