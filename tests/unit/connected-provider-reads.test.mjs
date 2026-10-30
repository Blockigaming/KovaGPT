import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  hasConnectionScopes,
  connectionAuthorizationUrl,
} from "../../src/integrations/connection-flows.mjs";
import {
  connectionReadRequest,
  readConnection,
} from "../../src/integrations/connection-read.server.mjs";
import {
  selectOAuthTokens,
  oauthRefreshRequest,
  selectRefreshTokens,
} from "../../src/integrations/oauth-token-request.server.mjs";

test("a Microsoft account is usable only for the service scopes it actually has", () => {
  const account = {
    provider_id: "microsoft",
    status: "connected",
    granted_scopes: ["Mail.Read"],
    token_expires_at: null,
  };
  assert.equal(canReadConnection(account, "outlook"), true);
  assert.equal(canReadConnection(account, "onedrive"), false);
  assert.equal(
    canReadConnection({ ...account, deleted_at: new Date().toISOString() }, "outlook"),
    false,
  );
  assert.equal(
    canReadConnection({ ...account, token_expires_at: new Date(0).toISOString() }, "outlook"),
    false,
  );
  assert.equal(canReadConnection({ ...account, status: "revoked" }, "outlook"), false);
  assert.equal(
    hasConnectionScopes(["https://graph.microsoft.com/Files.Read.All"], ["Files.Read"]),
    true,
  );
  assert.equal(hasConnectionScopes(["Files.Read"], ["Sites.Read.All"]), false);
});

test("authorization redirects reject other origins, paths, schemes, and URL credentials", () => {
  const valid = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=test";
  assert.equal(connectionAuthorizationUrl("microsoft", valid), valid);
  for (const url of [
    "https://evil.example/",
    "javascript:alert(1)",
    "https://login.microsoftonline.com/evil",
    "https://name:password@login.microsoftonline.com/common/oauth2/v2.0/authorize",
  ])
    assert.equal(connectionAuthorizationUrl("microsoft", url), null);
  assert.equal(connectionAuthorizationUrl("__proto__", valid), null);
});

test("all service requests use fixed HTTPS endpoints, bounded queries and no redirects", () => {
  const hosts = new Set(["graph.microsoft.com", "api.notion.com", "api.linear.app", "slack.com"]);
  for (const id of Object.keys(CONNECTION_FLOWS)) {
    const req = connectionReadRequest(id, "a&?$top=999' https://evil.example", "fake-token");
    assert.equal(new URL(req.url).protocol, "https:");
    assert.ok(hosts.has(new URL(req.url).hostname));
    assert.equal(req.init.headers.Authorization, "Bearer fake-token");
    assert.equal(req.init.redirect, "error");
    assert.ok(req.init.signal instanceof AbortSignal);
  }
  const drive = connectionReadRequest("onedrive", "O'Brien", "fake-token");
  assert.match(decodeURIComponent(new URL(drive.url).pathname), /q='O''Brien'/);
  const mail = connectionReadRequest("outlook", "hello", "fake-token");
  assert.equal(new URL(mail.url).searchParams.get("$top"), "10");
  assert.equal(new URL(mail.url).searchParams.get("$search"), '"hello"');
  const linear = connectionReadRequest("linear", "title) { secret }", "fake-token");
  assert.equal(JSON.parse(linear.init.body).variables.query, "title) { secret }");
  assert.doesNotMatch(JSON.parse(linear.init.body).query, /secret/);
  for (const bad of ["", " ", "x".repeat(301)])
    assert.throws(
      () => connectionReadRequest("notion", bad, "fake-token"),
      /invalid_connection_query/,
    );
  for (const id of ["__proto__", "constructor", "unknown"])
    assert.throws(() => connectionReadRequest(id, "query", "fake-token"), /unsupported_connection/);
});

test("provider results are bounded and expose source fields without credentials or unsafe links", async () => {
  for (const [id, data] of [
    [
      "outlook",
      {
        value: [
          {
            id: "one",
            subject: "Mail",
            bodyPreview: "hello",
            webLink: "https://outlook.live.com/mail/one",
          },
        ],
      },
    ],
    ["onedrive", { value: [{ id: "one", name: "File", webUrl: "javascript:alert(1)" }] }],
    [
      "sharepoint",
      { value: [{ id: "one", displayName: "Site", webUrl: "https://example.sharepoint.com/" }] },
    ],
    [
      "ms-teams",
      {
        value: [
          { id: "one", displayName: "hello team" },
          { id: "two", displayName: "other" },
        ],
      },
    ],
    [
      "notion",
      {
        results: [
          {
            id: "one",
            properties: { Name: { type: "title", title: [{ plain_text: "Page" }] } },
            url: "https://notion.so/one",
          },
        ],
      },
    ],
    [
      "linear",
      {
        data: { issues: { nodes: [{ id: "one", title: "Issue", url: "https://linear.app/one" }] } },
      },
    ],
    [
      "slack",
      {
        ok: true,
        messages: {
          matches: [
            { ts: "one", text: "Message", permalink: "https://example.slack.com/archives/one" },
          ],
        },
      },
    ],
  ]) {
    const result = await readConnection(id, "hello", "fake-token", async () =>
      Response.json({ ...data, secret: "must-not-leak" }),
    );
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, "one");
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak|fake-token|javascript:/);
  }
  const result = await readConnection("outlook", "hello", "fake-token", async () =>
    Response.json({
      value: Array.from({ length: 100 }, () => ({
        subject: "x".repeat(500),
        bodyPreview: "y".repeat(3000),
      })),
    }),
  );
  assert.equal(result.results.length, 10);
  assert.equal(result.results[0].title.length, 300);
  assert.equal(result.results[0].snippet.length, 2000);
});

test("HTTP, GraphQL and Slack application errors never become successful empty results", async () => {
  for (const status of [401, 403, 429, 500])
    await assert.rejects(
      readConnection(
        "outlook",
        "hello",
        "fake-token",
        async () => new Response("private provider error", { status }),
      ),
      /connection_/,
    );
  await assert.rejects(
    readConnection("linear", "hello", "fake-token", async () =>
      Response.json({ errors: [{ message: "private" }], data: null }),
    ),
    /connection_read_failed/,
  );
  await assert.rejects(
    readConnection("slack", "hello", "fake-token", async () =>
      Response.json({ ok: false, error: "invalid_auth" }),
    ),
    /connection_read_failed/,
  );
  await assert.rejects(
    readConnection("outlook", "hello", "fake-token", async () => Response.json({ value: "bad" })),
    /invalid_connection_response/,
  );
  await assert.rejects(
    readConnection("notion", "hello", "fake-token", async () => new Response("x".repeat(512001))),
    /provider_response_too_large/,
  );
});

test("Slack stores only the explicitly granted user token and its actual scopes", () => {
  const result = selectOAuthTokens("slack", {
    ok: true,
    access_token: "bot-token",
    scope: "bot-scope",
    authed_user: {
      access_token: "user-token",
      token_type: "user",
      scope: "search:read",
      refresh_token: "user-refresh",
      expires_in: 3600,
    },
  });
  assert.equal(result.access_token, "user-token");
  assert.equal(result.scope, "search:read");
  assert.equal(result.refresh_token, "user-refresh");
  assert.throws(
    () => selectOAuthTokens("slack", { ok: true, access_token: "bot-token" }),
    /oauth_access_token_missing/,
  );
  assert.throws(
    () => selectOAuthTokens("slack", { ok: false, error: "invalid_code" }),
    /oauth_token_exchange_failed/,
  );
  assert.throws(
    () => selectOAuthTokens("notion", { error: "invalid_client" }),
    /oauth_token_exchange_failed/,
  );
});

test("refresh requests retain client authentication and validate user-token expiration", () => {
  for (const providerId of ["microsoft", "linear", "slack"]) {
    const request = oauthRefreshRequest({
      providerId,
      clientId: "example",
      clientSecret: "secret+&=",
      refreshToken: "refresh+&=",
    });
    assert.equal(request.body.get("grant_type"), "refresh_token");
    assert.equal(request.body.get("client_secret"), "secret+&=");
    assert.equal(request.body.get("refresh_token"), "refresh+&=");
    assert.equal(request.redirect, "error");
  }
  assert.equal(
    selectRefreshTokens("slack", {
      access_token: "refreshed-user",
      token_type: "user",
      expires_in: 3600,
    }).access_token,
    "refreshed-user",
  );
  assert.throws(() =>
    selectRefreshTokens("slack", { access_token: "bot", token_type: "bot", expires_in: 3600 }),
  );
  assert.throws(
    () => selectRefreshTokens("microsoft", { access_token: "token-without-expiry" }),
    /refresh_expiry_missing/,
  );
});
