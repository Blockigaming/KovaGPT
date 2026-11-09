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
import { packSalesforceCredential } from "../../src/integrations/salesforce-credential.server.mjs";
import {
  selectOAuthTokens,
  oauthTokenRequest,
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
  assert.equal(canReadConnection(account, "outlook-calendar"), false);
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

test("calendar reads accept only an actual basic-or-broader calendar grant on the selected Microsoft account", () => {
  const account = { provider_id: "microsoft", status: "connected", token_expires_at: null };
  for (const scope of ["Calendars.ReadBasic", "Calendars.Read", "Calendars.ReadWrite"])
    for (const prefix of ["", "https://graph.microsoft.com/"])
      assert.equal(
        canReadConnection({ ...account, granted_scopes: [prefix + scope] }, "outlook-calendar"),
        true,
      );
  for (const scopes of [[], ["Mail.Read"], ["Files.Read.All"], ["Calendars.Read.Shared"]])
    assert.equal(
      canReadConnection({ ...account, granted_scopes: scopes }, "outlook-calendar"),
      false,
    );
  assert.equal(
    canReadConnection(
      { ...account, provider_id: "github", granted_scopes: ["Calendars.ReadBasic"] },
      "outlook-calendar",
    ),
    false,
  );
});

test("calendar subject prefixes are escaped as data and requests read only basic fields from the default calendar", () => {
  const query = "O'Brien') or true or startsWith(subject,'";
  const req = connectionReadRequest("outlook-calendar", query, "fake-token");
  const url = new URL(req.url);
  assert.equal(url.origin + url.pathname, "https://graph.microsoft.com/v1.0/me/calendar/events");
  assert.equal(
    url.searchParams.get("$filter"),
    `startsWith(subject,'${query.replaceAll("'", "''")}')`,
  );
  assert.equal(url.searchParams.get("$select"), "id,subject,start,end,webLink");
  assert.equal(url.searchParams.get("$top"), "10");
  assert.equal(req.init.method, "GET");
  assert.equal(req.init.body, undefined);
  assert.equal(req.init.headers.Prefer, 'outlook.timezone="UTC"');
  assert.equal(req.init.redirect, "error");
});

test("calendar results show bounded event times and discard provider bodies, attendees, tokens and pagination", async () => {
  let calls = 0;
  const result = await readConnection("outlook-calendar", "Meeting", "fake-token", async () => {
    calls += 1;
    return Response.json({
      "@odata.nextLink": "https://evil.example/next?token=must-not-leak",
      value: Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        subject: "Meeting " + i,
        start: { dateTime: "2026-11-02T12:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-11-02T13:00:00", timeZone: "UTC" },
        webLink: "https://outlook.live.com/calendar/item/" + i,
        bodyPreview: "must-not-leak",
        attendees: ["must-not-leak"],
        access_token: "must-not-leak",
      })),
    });
  });
  assert.equal(calls, 1);
  assert.equal(result.service, "Outlook Calendar");
  assert.equal(result.results.length, 10);
  assert.equal(
    result.results[0].snippet,
    "Start: 2026-11-02T12:00:00 (UTC); End: 2026-11-02T13:00:00 (UTC)",
  );
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|fake-token|evil\.example/);
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
  const hosts = new Set([
    "graph.microsoft.com",
    "api.notion.com",
    "api.linear.app",
    "slack.com",
    "fixture.my.salesforce.com",
    "api.dropboxapi.com",
    "api.box.com",
    "api.calendly.com",
    "api.canva.com",
  ]);
  const salesforceToken = packSalesforceCredential("fake-token", {
    active: true,
    organization_id: "00D000000000001",
    user_id: "005000000000001",
    urls: { query: "https://fixture.my.salesforce.com/services/data/v67.0/query" },
  });
  for (const id of Object.keys(CONNECTION_FLOWS)) {
    const req = connectionReadRequest(
      id,
      "a&?$top=999' https://evil.example",
      id === "salesforce" ? salesforceToken : "fake-token",
      id === "calendly" ? { calendlyUserUri: "https://api.calendly.com/users/KNOWN_USER" } : {},
    );
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
  for (const providerId of ["microsoft", "linear", "slack", "salesforce"]) {
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

test("provider control characters and oversized URLs cannot overflow or truncate serialized tool results", async () => {
  const value = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    subject: "Provider result",
    bodyPreview: "\u0000".repeat(2000),
    webLink: "https://example.test/" + "x".repeat(8000),
  }));
  const result = await readConnection("outlook", "needle", "fixture-token", async () =>
    Response.json({ value }),
  );
  const serialized = JSON.stringify(result);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 24000);
  assert.ok(result.results.length > 0 && result.results.length < 10);
  assert.ok(result.results.every((row) => row.url === null));
  assert.deepEqual(JSON.parse(serialized), result);
  assert.equal(result.limited, true);
});

test("multibyte provider text stays within the UTF8 tool budget with complete JSON records", async () => {
  const value = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    subject: "Evidence",
    bodyPreview: "🧪".repeat(2000),
    webLink: "https://example.test/evidence",
  }));
  const result = await readConnection("outlook", "needle", "fixture-token", async () =>
    Response.json({ value }),
  );
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 24000);
  assert.ok(result.results.length > 0 && result.results.length < 10);
  assert.ok(result.results.every((row) => row.id && row.title && row.snippet));
});

test("Dropbox and Box authorization URLs are pinned to official hosts", () => {
  for (const [provider, url] of [
    ["dropbox", "https://www.dropbox.com/oauth2/authorize?state=fixture"],
    ["box", "https://account.box.com/api/oauth2/authorize?state=fixture"],
  ]) {
    assert.equal(connectionAuthorizationUrl(provider, url), url);
    assert.equal(
      connectionAuthorizationUrl(provider, "https://evil.example/oauth2/authorize"),
      null,
    );
    assert.equal(connectionAuthorizationUrl(provider, url.replace("https://", "http://")), null);
  }
});

test("Dropbox and Box searches are bounded, read-only and correctly encoded", () => {
  const query = "report ' & https://evil.example";
  const dropbox = connectionReadRequest("dropbox", query, "fake-token");
  assert.equal(dropbox.url, "https://api.dropboxapi.com/2/files/search_v2");
  assert.equal(dropbox.init.method, "POST");
  assert.deepEqual(JSON.parse(dropbox.init.body), {
    query,
    options: { max_results: 10 },
  });
  const box = connectionReadRequest("box", query, "fake-token");
  assert.equal(
    new URL(box.url).origin + new URL(box.url).pathname,
    "https://api.box.com/2.0/search",
  );
  assert.equal(new URL(box.url).searchParams.get("query"), query);
  assert.equal(new URL(box.url).searchParams.get("limit"), "10");
  assert.equal(new URL(box.url).searchParams.get("type"), "file");
  assert.equal(box.init.method, "GET");
  for (const req of [dropbox, box]) {
    assert.equal(req.init.redirect, "error");
    assert.ok(req.init.signal instanceof AbortSignal);
  }
});

test("Dropbox and Box search results expose only safe metadata and at most ten items", async () => {
  const dropbox = await readConnection("dropbox", "report", "fake-token", async () =>
    Response.json({
      matches: Array.from({ length: 16 }, (_, i) => ({
        metadata: {
          ".tag": "metadata",
          metadata: {
            id: "id:" + i,
            name: "Report " + i,
            path_display: "/Projects/Report " + i,
            access_token: "must-not-leak",
          },
        },
      })),
      cursor: "must-not-leak",
    }),
  );
  assert.equal(dropbox.results.length, 10);
  assert.equal(dropbox.results[0].title, "Report 0");
  assert.equal(dropbox.results[0].snippet, "/Projects/Report 0");
  assert.equal(dropbox.results[0].url, null);
  const box = await readConnection("box", "budget", "fake-token", async () =>
    Response.json({
      entries: [
        {
          id: "one",
          name: "Budget",
          description: "File",
          shared_link: { url: "javascript:alert(1)" },
          access_token: "must-not-leak",
        },
      ],
    }),
  );
  assert.equal(box.results.length, 1);
  assert.equal(box.results[0].title, "Budget");
  assert.equal(box.results[0].url, null);
  assert.doesNotMatch(JSON.stringify({ dropbox, box }), /must-not-leak|fake-token|javascript:/);
});

test("Dropbox and Box token refresh requests use the confidential-client grant", () => {
  for (const providerId of ["dropbox", "box"]) {
    const refresh = oauthRefreshRequest({
      providerId,
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "rotating-token",
    });
    assert.equal(refresh.method, "POST");
    assert.equal(refresh.body.get("grant_type"), "refresh_token");
    assert.equal(refresh.body.get("refresh_token"), "rotating-token");
  }
});

test("Calendly requires explicit read scopes and a fixed account-scoped event route", () => {
  const id = "https://api.calendly.com/users/KNOWN_USER";
  const account = {
    provider_id: "calendly",
    status: "connected",
    token_expires_at: null,
    granted_scopes: ["users:read", "scheduled_events:read"],
  };
  assert.equal(canReadConnection(account, "calendly"), true);
  assert.equal(
    canReadConnection({ ...account, granted_scopes: ["users:read"] }, "calendly"),
    false,
  );
  assert.equal(canReadConnection({ ...account, status: "expired" }, "calendly"), false);
  assert.equal(
    connectionAuthorizationUrl(
      "calendly",
      "https://auth.calendly.com/oauth/authorize?state=fixture",
    ),
    "https://auth.calendly.com/oauth/authorize?state=fixture",
  );
  assert.equal(
    connectionAuthorizationUrl("calendly", "https://evil.example/oauth/authorize"),
    null,
  );
  assert.throws(
    () => connectionReadRequest("calendly", "meeting", "token"),
    /calendly_identity_unavailable/,
  );
  assert.throws(
    () =>
      connectionReadRequest("calendly", "meeting", "token", {
        calendlyUserUri: "https://evil.example/users/KNOWN_USER",
      }),
    /calendly_identity_unavailable/,
  );
  const request = connectionReadRequest("calendly", "meeting", "token", {
    calendlyUserUri: id,
  });
  const url = new URL(request.url);
  assert.equal(url.href.startsWith("https://api.calendly.com/scheduled_events?"), true);
  assert.equal(url.searchParams.get("user"), id);
  assert.equal(url.searchParams.get("count"), "100");
  assert.equal(url.searchParams.get("sort"), "start_time:desc");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.redirect, "error");
});

test("Calendly event reads verify their owner and bounded metadata", async () => {
  const userUri = "https://api.calendly.com/users/KNOWN_USER";
  const calls = [];
  const result = await readConnection(
    "calendly",
    "Review",
    "fake-token",
    async (url, init) => {
      calls.push([url, init]);
      if (url === "https://api.calendly.com/users/me")
        return Response.json({ resource: { uri: userUri } });
      return Response.json({
        collection: Array.from({ length: 30 }, (_, i) => ({
          uri: "https://api.calendly.com/scheduled_events/" + i,
          name: i < 15 ? "Review " + i : "Unrelated " + i,
          start_time: "2026-11-09T10:00:00Z",
          end_time: "2026-11-09T11:00:00Z",
          invitees: ["must-not-leak"],
          access_token: "must-not-leak",
        })),
      });
    },
    { calendlyExpectedUserUri: userUri },
  );
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1][0]).searchParams.get("user"), userUri);
  assert.equal(result.results.length, 10);
  assert.equal(result.results[0].title, "Review 0");
  assert.equal(result.results[0].url, null);
  assert.match(result.results[0].snippet, /Start: 2026-11-09T10:00:00Z/);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|fake-token|Unrelated/);
});

test("Calendly rejects a changed user identity before listing events", async () => {
  const calls = [];
  await assert.rejects(
    readConnection(
      "calendly",
      "Meeting",
      "fake-token",
      async (url) => {
        calls.push(url);
        return Response.json({
          resource: { uri: "https://api.calendly.com/users/OTHER_USER" },
        });
      },
      { calendlyExpectedUserUri: "https://api.calendly.com/users/KNOWN_USER" },
    ),
    /calendly_identity_changed/,
  );
  assert.deepEqual(calls, ["https://api.calendly.com/users/me"]);
});

test("Calendly requires PKCE and Basic client authentication for tokens", () => {
  const args = {
    providerId: "calendly",
    clientId: "client",
    clientSecret: "secret",
    code: "one-time-code",
    redirectUri: "https://kovagpt.com/api/integrations/oauth/callback/calendly",
    verifier: "random-verifier",
  };
  const initial = oauthTokenRequest(args);
  assert.equal(initial.method, "POST");
  assert.equal(
    initial.headers.Authorization,
    "Basic " + Buffer.from("client:secret").toString("base64"),
  );
  assert.equal(initial.body.get("code_verifier"), "random-verifier");
  assert.equal(initial.body.get("client_secret"), null);
  assert.throws(
    () => oauthTokenRequest({ ...args, verifier: undefined }),
    /oauth_pkce_verifier_missing/,
  );
  const refresh = oauthRefreshRequest({
    providerId: "calendly",
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "rotated",
  });
  assert.equal(refresh.method, "POST");
  assert.equal(refresh.body.get("refresh_token"), "rotated");
  assert.equal(refresh.headers.Authorization, initial.headers.Authorization);
});
