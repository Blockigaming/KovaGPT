import assert from "node:assert/strict";
import test from "node:test";
import { prepareKeyCredential } from "../../src/integrations/key-connection-credential.server.mjs";
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
import { isAccountProviderRead } from "../../src/integrations/account-provider-read.server.mjs";
import {
  selectOAuthTokens,
  oauthTokenRequest,
  oauthRefreshRequest,
  selectRefreshTokens,
} from "../../src/integrations/oauth-token-request.server.mjs";

test("a Notion internal integration can read only its bound page", async () => {
  const apiKey = "ntn_fixture_read_only";
  const pageId = "12345678-abcd-4123-8123-12345678abcd";
  const { token, accountId } = prepareKeyCredential("notion-private", {
    apiKey,
    pageId: pageId.replaceAll("-", ""),
  });
  assert.equal(accountId, pageId);
  let allowed = false;
  let calls = 0;
  const request = async (url, init) => {
    assert.equal(allowed, true);
    calls++;
    assert.equal(new URL(url).pathname, `/v1/pages/${pageId}/markdown`);
    assert.equal(new URL(url).origin, "https://api.notion.com");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
    return Response.json({
      object: "page_markdown",
      id: pageId,
      markdown: "Fixture page only",
      truncated: false,
      unknown_block_ids: [],
    });
  };
  await assert.rejects(
    readConnection("notion-private", "12345678-abcd-4123-8123-12345678abce", token, request),
    /invalid_connection_query/u,
  );
  await assert.rejects(
    readConnection("notion-private", "open", token, request, {
      beforeRequest: async () => {
        throw new Error("connection_changed_or_expired");
      },
    }),
    /connection_changed_or_expired/u,
  );
  assert.equal(calls, 0);
  const result = await readConnection("notion-private", "open", token, request, {
    beforeRequest: async () => {
      allowed = true;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.results[0].snippet, "Fixture page only");
  assert.doesNotMatch(JSON.stringify(result), /ntn_fixture/u);
});

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

test("calendar reads accept only an actual full-read-or-broader calendar grant on the selected Microsoft account", () => {
  const account = { provider_id: "microsoft", status: "connected", token_expires_at: null };
  for (const scope of ["Calendars.Read", "Calendars.ReadWrite"])
    for (const prefix of ["", "https://graph.microsoft.com/"])
      assert.equal(
        canReadConnection({ ...account, granted_scopes: [prefix + scope] }, "outlook-calendar"),
        true,
      );
  for (const scopes of [
    [],
    ["Mail.Read"],
    ["Files.Read.All"],
    ["Calendars.Read.Shared"],
    ["Calendars.ReadBasic"],
  ])
    assert.equal(
      canReadConnection({ ...account, granted_scopes: scopes }, "outlook-calendar"),
      false,
    );
  assert.equal(
    canReadConnection(
      { ...account, provider_id: "github", granted_scopes: ["Calendars.Read"] },
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

test("calendar reads distinguish a missing default calendar without exposing the provider error body", async () => {
  await assert.rejects(
    readConnection("outlook-calendar", "Meeting", "fake-token", async () =>
      Response.json({ error: { message: "private provider data" } }, { status: 404 }),
    ),
    (error) => error.message === "outlook_default_calendar_unavailable" && error.cause === 404,
  );
});

test("a rejected Outlook subject filter falls back to a bounded, reauthorized calendar read", async () => {
  const calls = [];
  let checks = 0;
  const result = await readConnection(
    "outlook-calendar",
    "Meeting",
    "fake-token",
    async (url) => {
      calls.push(new URL(url));
      if (calls.length === 1) return new Response(null, { status: 400 });
      assert.equal(checks, 1);
      return Response.json({
        value: [
          { id: "1", subject: "Private unrelated event" },
          { id: "2", subject: "Meeting marker" },
        ],
      });
    },
    {
      beforeRequest: async () => {
        checks++;
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pathname, calls[0].pathname);
  assert.equal(calls[1].searchParams.has("$filter"), false);
  assert.equal(calls[1].searchParams.get("$top"), "50");
  assert.deepEqual(
    result.results.map(({ title }) => title),
    ["Meeting marker"],
  );
  assert.equal(result.limited, true);
});

test("OneDrive falls back to a bounded, reauthorized root name search if Graph rejects full search", async () => {
  const calls = [];
  let checked = false;
  const result = await readConnection(
    "onedrive",
    "ReadMe",
    "fixture-token",
    async (url) => {
      const request = new URL(url);
      calls.push(request);
      if (calls.length === 1) return new Response(null, { status: 501 });
      assert.equal(checked, true);
      assert.equal(request.pathname, "/v1.0/me/drive/root/children");
      assert.equal(request.searchParams.get("$top"), "50");
      return Response.json({
        value: [
          { id: "1", name: "Private unrelated file" },
          { id: "2", name: "README.md" },
        ],
      });
    },
    {
      beforeRequest: async () => {
        checked = true;
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(result.limited, true);
  assert.deepEqual(
    result.results.map(({ title }) => title),
    ["README.md"],
  );
  await assert.rejects(
    readConnection(
      "onedrive",
      "test",
      "fixture-token",
      async () => new Response(null, { status: 404 }),
    ),
    /onedrive_default_drive_unavailable/u,
  );
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
    "api.box.com",
    "api.meltwater.com",
    "api.vercel.com",
    "public-api.etoro.com",
    "eu.mixpanel.com",
    "api.canva.com",
    "api.figma.com",
    "api.calendly.com",
    "public-api.granola.ai",
    "public-api.gamma.app",
    "bigquery.googleapis.com",
    "api.hubapi.com",
    "api.stripe.com",
    "api.heygen.com",
    "api.notion.com",
    "api.linear.app",
    "slack.com",
    "fixture.my.salesforce.com",
  ]);
  const salesforceToken = packSalesforceCredential("fake-token", {
    active: true,
    organization_id: "00D000000000001",
    user_id: "005000000000001",
    urls: { query: "https://fixture.my.salesforce.com/services/data/v67.0/query" },
  });
  const credentials = {
    vercel: prepareKeyCredential("vercel", { apiKey: "fake-token", teamId: "team_fixture" }).token,
    mixpanel: prepareKeyCredential("mixpanel", {
      apiKey: "fake-token",
      region: "eu",
      username: "fixture",
      projectId: "42",
    }).token,
    etoro: prepareKeyCredential("etoro", { apiKey: "fake-token", userKey: "fixture-user-key" })
      .token,
    "notion-private": prepareKeyCredential("notion-private", {
      apiKey: "fake-token",
      pageId: "12345678-abcd-4123-8123-12345678abcd",
    }).token,
  };
  for (const id of Object.keys(CONNECTION_FLOWS)) {
    // Account adapters with multi-step requests have transport-level fixtures of their own.
    if (isAccountProviderRead(id) || ["tana", "custom-mcp"].includes(id)) continue;
    const token = credentials[id] ?? (id === "granola" ? "grn_test_only" : "fake-token");
    const req = connectionReadRequest(
      id,
      id === "figma"
        ? "https://www.figma.com/design/Abc123/title"
        : ["stripe", "vercel", "etoro"].includes(id)
          ? "recent"
          : id === "google-bigquery"
            ? "example-project"
            : id === "notion-private"
              ? "open"
              : "a&?$top=999' https://evil.example",
      id === "salesforce" ? salesforceToken : token,
      { calendlyUser: "https://api.calendly.com/users/test-user" },
    );
    assert.equal(new URL(req.url).protocol, "https:");
    assert.ok(hosts.has(new URL(req.url).hostname));
    if (id === "hyperframes-heygen") {
      assert.equal(req.init.headers["X-Api-Key"], token);
      assert.equal(req.init.headers.Authorization, undefined);
    } else if (id === "meltwater") {
      assert.equal(req.init.headers.apikey, "fake-token");
      assert.equal(req.init.headers.Authorization, undefined);
    } else if (id === "etoro") {
      assert.equal(req.init.headers["x-api-key"], "fake-token");
      assert.equal(req.init.headers["x-user-key"], "fixture-user-key");
      assert.equal(req.init.headers.Authorization, undefined);
    } else if (id === "mixpanel") {
      assert.equal(
        req.init.headers.Authorization,
        "Basic " + Buffer.from("fixture:fake-token").toString("base64"),
      );
    } else {
      assert.equal(
        req.init.headers.Authorization,
        `Bearer ${["notion-private", "vercel"].includes(id) ? "fake-token" : token}`,
      );
    }
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

test("Box uses its own read grant, returns only file metadata, and rotates refresh tokens", async () => {
  const account = {
    provider_id: "box",
    status: "connected",
    token_expires_at: null,
    granted_scopes: ["root_readonly"],
  };
  assert.equal(canReadConnection(account, "box"), true);
  assert.equal(canReadConnection({ ...account, granted_scopes: ["Mail.Read"] }, "box"), false);
  assert.equal(canReadConnection({ ...account, status: "revoked" }, "box"), false);
  const authorize = "https://account.box.com/api/oauth2/authorize?scope=root_readonly";
  assert.equal(connectionAuthorizationUrl("box", authorize), authorize);
  assert.equal(connectionAuthorizationUrl("box", "https://account.box.com/api/oauth2/token"), null);
  const result = await readConnection("box", "a&limit=50", "fixture", async (target, init) => {
    const url = new URL(target);
    assert.equal(url.origin + url.pathname, "https://api.box.com/2.0/search");
    assert.equal(url.searchParams.get("query"), "a&limit=50");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(init.method, "GET");
    return Response.json({
      entries: [
        { type: "file", id: "123", name: "Brief", description: "Summary", download_url: "private" },
        { type: "folder", id: "456" },
        { type: "file", id: "123?redirect=evil" },
      ],
    });
  });
  assert.deepEqual(result.results, [
    { id: "123", title: "Brief", snippet: "Summary", url: "https://app.box.com/file/123" },
  ]);
  const refresh = oauthRefreshRequest({
    providerId: "box",
    clientId: "app",
    clientSecret: "fixture-secret",
    refreshToken: "old-refresh",
  });
  assert.equal(refresh.body.get("refresh_token"), "old-refresh");
  assert.equal(refresh.redirect, "error");
  const token = { access_token: "new-access", expires_in: 3600 };
  assert.throws(() => selectRefreshTokens("box", token), /refresh_token_missing/);
  assert.equal(
    selectRefreshTokens("box", { ...token, refresh_token: "new-refresh" }).refresh_token,
    "new-refresh",
  );
});

test("Teams message search requires a dedicated grant and returns only bounded message matches", async () => {
  const account = {
    provider_id: "microsoft",
    status: "connected",
    token_expires_at: null,
  };
  assert.equal(
    canReadConnection({ ...account, granted_scopes: ["Team.ReadBasic.All"] }, "ms-teams-messages"),
    false,
  );
  assert.equal(
    canReadConnection({ ...account, granted_scopes: ["Mail.Read"] }, "ms-teams-messages"),
    false,
  );
  assert.equal(
    canReadConnection(
      { ...account, granted_scopes: ["https://graph.microsoft.com/Chat.Read"] },
      "ms-teams-messages",
    ),
    true,
  );
  const result = await readConnection("ms-teams-messages", "demo", "fixture", async (url, init) => {
    assert.equal(url, "https://graph.microsoft.com/v1.0/search/query");
    assert.deepEqual(JSON.parse(init.body), {
      requests: [
        { entityTypes: ["chatMessage"], query: { queryString: "demo" }, from: 0, size: 10 },
      ],
    });
    return Response.json({
      value: [
        {
          hitsContainers: [
            {
              hits: [
                {
                  summary: "demo snippet",
                  resource: {
                    "@odata.type": "microsoft.graph.chatMessage",
                    id: "42",
                    subject: "",
                    from: { emailAddress: { name: "Casey", address: "private@example.invalid" } },
                    webLink: "https://outlook.office365.com/owa/?ItemID=42",
                  },
                },
                { resource: { "@odata.type": "#microsoft.graph.message", id: "other" } },
              ],
            },
          ],
        },
      ],
    });
  });
  assert.deepEqual(result.results, [
    {
      id: "42",
      title: "Casey",
      snippet: "demo snippet",
      url: "https://outlook.office365.com/owa/?ItemID=42",
    },
  ]);
});

test("Notion reads bounded Markdown for an exact page ID and reports partial content", async () => {
  const id = "b55c9c91-384d-452b-81db-d1ef79372b75";
  const result = await readConnection("notion", id, "fixture", async (target, init) => {
    const url = new URL(target);
    assert.equal(url.origin + url.pathname, `https://api.notion.com/v1/pages/${id}/markdown`);
    assert.equal(url.searchParams.get("include_transcript"), null);
    assert.equal(init.headers["Notion-Version"], "2026-03-11");
    assert.equal(init.method, "GET");
    return Response.json({
      object: "page_markdown",
      id,
      markdown: "x".repeat(3600),
      truncated: false,
      unknown_block_ids: [],
    });
  });
  assert.equal(result.limited, true);
  assert.equal(result.results[0].snippet.length, 3500);
  await assert.rejects(
    readConnection("notion", id, "fixture", async () => new Response(null, { status: 403 })),
    /connection_permission_required/,
  );
  await assert.rejects(
    readConnection("notion", id, "fixture", async () =>
      Response.json({
        object: "page_markdown",
        id: "different-page",
        markdown: "private",
      }),
    ),
    /invalid_connection_response/,
  );
});

test("Canva search uses metadata-only authorization and filters returned links", async () => {
  const account = {
    provider_id: "canva",
    status: "connected",
    token_expires_at: null,
    granted_scopes: ["design:meta:read"],
  };
  assert.equal(canReadConnection(account, "canva"), true);
  assert.equal(canReadConnection({ ...account, granted_scopes: [] }, "canva"), false);
  const result = await readConnection("canva", "draft & review", "fixture", async (target) => {
    assert.equal(new URL(target).searchParams.get("query"), "draft & review");
    return Response.json({
      items: [
        {
          id: "demo",
          title: "Draft",
          owner: { user_id: "private" },
          urls: { view_url: "https://www.canva.com/design/demo/view", edit_url: "private" },
        },
        { id: "other", title: "Review", urls: { view_url: "https://example.invalid/private" } },
      ],
      continuation: "private",
    });
  });
  assert.equal(result.results[0].url, "https://www.canva.com/design/demo/view");
  assert.equal(result.results[1].url, null);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("Figma extracts only a design file key and returns bounded metadata", async () => {
  const result = await readConnection(
    "figma",
    "https://www.figma.com/design/Abc123/Prototype?node-id=1-2",
    "fixture",
    async (target) => {
      assert.equal(target, "https://api.figma.com/v1/files/Abc123/meta");
      return Response.json({
        file: {
          name: "Prototype",
          url: "https://www.figma.com/design/Abc123",
          creator: { email: "private" },
          thumbnail_url: "private",
        },
      });
    },
  );
  assert.equal(result.results[0].title, "Prototype");
  assert.doesNotMatch(JSON.stringify(result), /private/);
  for (const input of [
    "https://example.invalid/design/Abc123",
    "https://www.figma.com/design/../private",
    "https://www.figma.com/design/Abc%2F123",
  ])
    assert.throws(() => connectionReadRequest("figma", input, "fixture"), /invalid_figma_file/);
});

test("Canva and Figma exchanges use basic client authentication with provider-specific refresh", () => {
  const credentials = { clientId: "client", clientSecret: "secret" };
  for (const providerId of ["canva", "figma"]) {
    const req = oauthTokenRequest({
      providerId,
      ...credentials,
      code: "fixture-code",
      redirectUri: "https://kovagpt.com/callback",
      verifier: "fixture-verifier",
    });
    assert.equal(
      req.headers.Authorization,
      "Basic " + Buffer.from("client:secret").toString("base64"),
    );
    assert.equal(req.body.get("client_secret"), null);
    assert.equal(req.body.get("code_verifier"), "fixture-verifier");
    const refresh = oauthRefreshRequest({ providerId, ...credentials, refreshToken: "old" });
    assert.equal(refresh.headers.Authorization, req.headers.Authorization);
    assert.equal(refresh.body.get("grant_type"), providerId === "canva" ? "refresh_token" : null);
    assert.equal(refresh.body.get("refresh_token"), "old");
  }
  assert.throws(
    () => selectRefreshTokens("canva", { access_token: "new", expires_in: 3600 }),
    /refresh_token_missing/,
  );
  assert.equal(
    selectRefreshTokens("figma", { access_token: "new", expires_in: 3600 }).access_token,
    "new",
  );
});

test("Calendly searches upcoming meetings only for the linked provider account", async () => {
  const calendlyUser = "https://api.calendly.com/users/fixture-user";
  const result = await readConnection(
    "calendly",
    "Demo",
    "fixture",
    async (target, init) => {
      const url = new URL(target);
      assert.equal(url.origin + url.pathname, "https://api.calendly.com/scheduled_events");
      assert.equal(url.searchParams.get("user"), calendlyUser);
      assert.equal(url.searchParams.has("organization"), false);
      assert.equal(url.searchParams.get("status"), "active");
      assert.equal(init.method, "GET");
      return Response.json({
        collection: [
          {
            uri: "https://api.calendly.com/scheduled_events/one",
            name: "Demo",
            status: "active",
            start_time: "2026-12-15T12:00:00Z",
            end_time: "2026-12-15T12:30:00Z",
            location: { join_url: "private" },
          },
          { name: "Demo cancelled", status: "canceled" },
          { name: "Planning", status: "active" },
        ],
        pagination: { next_page: "private" },
      });
    },
    { calendlyUser },
  );
  assert.deepEqual(result.results, [
    {
      id: "https://api.calendly.com/scheduled_events/one",
      title: "Demo",
      snippet: "2026-12-15T12:00:00Z to 2026-12-15T12:30:00Z",
      url: null,
    },
  ]);
  assert.throws(
    () =>
      connectionReadRequest("calendly", "upcoming", "fixture", {
        calendlyUser: "https://api.calendly.com.evil.example/users/fixture-user",
      }),
    /invalid_calendly_account/,
  );
});

test("BigQuery lists bounded dataset metadata for the exact requested project", async () => {
  for (const query of ["../datasets", "good-project/../x", "https://example.invalid", "a%2fb"])
    assert.throws(
      () => connectionReadRequest("google-bigquery", query, "fixture"),
      /invalid_bigquery_project/,
    );
  const result = await readConnection(
    "google-bigquery",
    "example-project",
    "fixture",
    async (target, init) => {
      const url = new URL(target);
      assert.equal(
        url.origin + url.pathname,
        "https://bigquery.googleapis.com/bigquery/v2/projects/example-project/datasets",
      );
      assert.equal(url.searchParams.get("maxResults"), "10");
      assert.equal(init.method, "GET");
      return Response.json({
        kind: "bigquery#datasetList",
        datasets: [
          {
            datasetReference: { projectId: "example-project", datasetId: "demo_data" },
            location: "US",
            access: ["private"],
          },
          { datasetReference: { projectId: "other-project", datasetId: "private_data" } },
        ],
        nextPageToken: "private",
      });
    },
  );
  assert.deepEqual(result.results, [
    { id: "demo_data", title: "demo_data", url: null, snippet: "US" },
  ]);
});

test("HubSpot company search exposes only the selected public-facing CRM fields", async () => {
  const result = await readConnection("hubspot", "Demo", "fixture", async (target, init) => {
    assert.equal(target, "https://api.hubapi.com/crm/objects/2026-09/companies/search");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      query: "Demo",
      properties: ["name", "domain"],
      limit: 10,
    });
    return Response.json({
      results: [
        { id: "12", properties: { name: "Demo Co", domain: "example.org", phone: "private" } },
      ],
    });
  });
  assert.deepEqual(result.results, [
    { id: "12", title: "Demo Co", url: null, snippet: "example.org" },
  ]);
});

test("new connector actions require their own verified grants", () => {
  for (const id of ["calendly", "google-bigquery", "hubspot"]) {
    const flow = CONNECTION_FLOWS[id];
    const account = {
      provider_id: id,
      status: "connected",
      token_expires_at: null,
      granted_scopes: flow.scopes,
    };
    assert.equal(canReadConnection(account, id), true);
    assert.equal(canReadConnection({ ...account, granted_scopes: [] }, id), false);
    assert.equal(canReadConnection({ ...account, provider_id: "google" }, id), false);
    assert.equal(canReadConnection({ ...account, status: "revoked" }, id), false);
  }
});

test("Calendly uses PKCE with Basic client auth and HubSpot carries the granted portal and scopes", () => {
  const request = oauthTokenRequest({
    providerId: "calendly",
    clientId: "app",
    clientSecret: "secret",
    code: "fixture-code",
    redirectUri: "https://kovagpt.com/callback",
    verifier: "fixture-verifier",
  });
  assert.equal(
    request.headers.Authorization,
    "Basic " + Buffer.from("app:secret").toString("base64"),
  );
  assert.equal(request.body.get("code_verifier"), "fixture-verifier");
  assert.equal(request.body.has("client_secret"), false);
  const fixture = { access_token: "access", refresh_token: "rotate", expires_in: 1800 };
  const calendlyUser = "https://api.calendly.com/users/fixture-user";
  assert.equal(
    selectRefreshTokens("calendly", { ...fixture, owner: calendlyUser }).provider_account_id,
    calendlyUser,
  );
  assert.throws(
    () => selectRefreshTokens("calendly", { ...fixture, refresh_token: undefined }),
    /refresh_token_missing/,
  );
  assert.deepEqual(
    selectRefreshTokens("hubspot", {
      ...fixture,
      hub_id: 123,
      scopes: ["oauth", "crm.objects.companies.read"],
    }),
    { ...fixture, provider_account_id: "123", scope: "oauth crm.objects.companies.read" },
  );
  const invalid = selectRefreshTokens("hubspot", {
    ...fixture,
    hub_id: "unverified",
    scopes: ["oauth", "crm.objects.companies.read other"],
    scope: "crm.objects.companies.read",
  });
  assert.equal(invalid.scope, undefined);
  assert.equal(invalid.provider_account_id, undefined);
});

test("provider errors or malformed response bodies do not verify connector reads", async () => {
  const options = { calendlyUser: "https://api.calendly.com/users/fixture-user" };
  for (const id of ["calendly", "google-bigquery", "hubspot"]) {
    for (const [response, error] of [
      [Response.json({ value: [] }), /invalid_connection_response/],
      [new Response(null, { status: 403 }), /connection_permission_required/],
      [new Response(null, { status: 401 }), /connection_reauthorization_required/],
    ]) {
      await assert.rejects(
        readConnection(id, "example-project", "fixture", async () => response, options),
        error,
      );
    }
  }
  const empty = await readConnection("google-bigquery", "example-project", "fixture", async () =>
    Response.json({ kind: "bigquery#datasetList" }),
  );
  assert.deepEqual(empty.results, []);
});

test("HubSpot contact lookup needs a separate grant and only returns names", async () => {
  const account = {
    provider_id: "hubspot",
    status: "connected",
    token_expires_at: null,
    granted_scopes: ["crm.objects.companies.read"],
  };
  assert.equal(canReadConnection(account, "hubspot-contacts"), false);
  account.granted_scopes.push("crm.objects.contacts.read");
  assert.equal(canReadConnection(account, "hubspot-contacts"), true);
  const result = await readConnection("hubspot-contacts", "Demo", "fixture", async (url, init) => {
    assert.equal(url, "https://api.hubapi.com/crm/objects/2026-09/contacts/search");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.properties, ["firstname", "lastname"]);
    assert.equal(body.limit, 10);
    assert.equal(body.query, undefined);
    assert.deepEqual(
      body.filterGroups.map(({ filters }) => filters[0]),
      [
        { propertyName: "firstname", operator: "EQ", value: "Demo" },
        { propertyName: "lastname", operator: "EQ", value: "Demo" },
      ],
    );
    return Response.json({
      results: [
        { id: "12", properties: { firstname: "Demo", lastname: "User", email: "private" } },
      ],
    });
  });
  assert.deepEqual(result.results, [{ id: "12", title: "Demo User", url: null, snippet: "" }]);
});

test("Granola uses a single bounded note list and filters titles without sharing note contents", async () => {
  const key = "grn_fixture_key";
  assert.throws(() => connectionReadRequest("granola", "recent", "invalid"), /invalid_granola_key/);
  const result = await readConnection("granola", "Weekly", key, async (url, request) => {
    assert.equal(url, "https://public-api.granola.ai/v1/notes?page_size=25");
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, `Bearer ${key}`);
    return Response.json({
      notes: [
        {
          id: "not_AbC123xYz789Qw",
          object: "note",
          title: "Weekly meeting",
          created_at: "2026-11-20T14:00:00Z",
          owner: { email: "private" },
          transcript: "private",
        },
        { id: "not_ZbC123xYz789Qw", object: "note", title: "Other meeting" },
      ],
      cursor: "private",
    });
  });
  assert.deepEqual(result.results, [
    {
      id: "not_AbC123xYz789Qw",
      title: "Weekly meeting",
      url: null,
      snippet: "2026-11-20T14:00:00Z",
    },
  ]);
  assert.equal(result.limited, true);
  await assert.rejects(
    readConnection("granola", "recent", key, async () => new Response(null, { status: 401 })),
    /connection_reauthorization_required/,
  );
  await assert.rejects(
    readConnection("granola", "recent", key, async () => Response.json({ value: [] })),
    /invalid_connection_response/,
  );
});

test("Gamma document lookup uses its workspace read grant and returns only metadata", async () => {
  const account = { provider_id: "gamma", status: "connected", token_expires_at: null };
  assert.equal(canReadConnection({ ...account, granted_scopes: [] }, "gamma"), false);
  assert.equal(canReadConnection({ ...account, granted_scopes: ["gamma:read"] }, "gamma"), true);
  assert.equal(canReadConnection({ ...account, granted_scopes: ["generate"] }, "gamma"), true);
  assert.equal(
    connectionReadRequest("gamma", "recent", "token").url,
    "https://public-api.gamma.app/v1.0/gammas?limit=10",
  );
  const recent = await readConnection("gamma", "recent", "token", async () =>
    Response.json({ data: [{ id: "latest", title: "Latest" }] }),
  );
  assert.deepEqual(recent.results, [{ id: "latest", title: "Latest", url: null, snippet: "" }]);
  const result = await readConnection(
    "gamma",
    "Demo & report",
    "token",
    async (target, request) => {
      const url = new URL(target);
      assert.equal(url.origin + url.pathname, "https://public-api.gamma.app/v1.0/gammas/search");
      assert.equal(url.searchParams.get("q"), "Demo & report");
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(request.method, "GET");
      return Response.json({
        hits: [
          {
            id: "demo",
            title: "Demo",
            url: "https://gamma.app/docs/demo",
            updatedTime: "2026-11-22T10:00:00Z",
            highlight: "private document text",
          },
          { id: "other", title: "Other", url: "https://example.invalid/private" },
        ],
      });
    },
  );
  assert.deepEqual(result.results, [
    {
      id: "demo",
      title: "Demo",
      url: "https://gamma.app/docs/demo",
      snippet: "2026-11-22T10:00:00Z",
    },
    { id: "other", title: "Other", url: null, snippet: "" },
  ]);
  await assert.rejects(
    readConnection("gamma", "Demo", "token", async () => Response.json({ data: [] })),
    /invalid_connection_response/,
  );
  assert.throws(
    () => selectRefreshTokens("gamma", { access_token: "example", expires_in: 3600 }),
    /refresh_token_missing/,
  );
});

test("Stripe limits charge reads to the fixed API and excludes customer and payment details", async () => {
  assert.throws(
    () => connectionReadRequest("stripe", "ch_demo/../customers", "key"),
    /invalid_connection_query/,
  );
  const charge = {
    id: "ch_Demo",
    object: "charge",
    amount: 1100,
    currency: "usd",
    status: "succeeded",
    billing_details: { email: "private" },
    receipt_url: "private",
  };
  const result = await readConnection("stripe", "recent", "access", async (url, init) => {
    assert.equal(url, "https://api.stripe.com/v1/charges?limit=10");
    assert.equal(init.method, "GET");
    return Response.json({ object: "list", url: "/v1/charges", data: [charge] });
  });
  assert.deepEqual(result.results, [
    { id: "ch_Demo", title: "ch_Demo", url: null, snippet: "1100 in USD minor units · succeeded" },
  ]);
  assert.equal(
    connectionReadRequest("stripe", "ch_Demo", "access").url,
    "https://api.stripe.com/v1/charges/ch_Demo",
  );
  await assert.rejects(
    readConnection("stripe", "ch_Other", "access", async () => Response.json(charge)),
    /invalid_connection_response/,
  );
  await assert.rejects(
    readConnection("stripe", "recent", "access", async () => new Response(null, { status: 403 })),
    /connection_permission_required/,
  );
});

test("Stripe Apps exchanges keep the developer key in HTTP Basic and bind the rotated grant to the account and mode", () => {
  const config = {
    providerId: "stripe",
    clientId: "ca_Fixture",
    clientSecret: "sk_test_Fixture",
  };
  const exchange = oauthTokenRequest({
    ...config,
    code: "fixture-code",
    redirectUri: "https://kovagpt.com/callback",
  });
  assert.deepEqual(Object.fromEntries(exchange.body), {
    grant_type: "authorization_code",
    code: "fixture-code",
  });
  assert.equal(
    exchange.headers.Authorization,
    "Basic " + Buffer.from("sk_test_Fixture:").toString("base64"),
  );
  const response = {
    access_token: "access",
    refresh_token: "rotated",
    token_type: "bearer",
    livemode: false,
    stripe_user_id: "acct_Fixture",
    scope: "stripe_apps",
  };
  assert.deepEqual(selectRefreshTokens("stripe", response), {
    access_token: "access",
    refresh_token: "rotated",
    expires_in: 3600,
    scope: "stripe_apps",
    provider_account_id: "test:acct_Fixture",
  });
  assert.throws(
    () => selectRefreshTokens("stripe", { ...response, scope: "read_write" }),
    /oauth_scope_verification_failed/,
  );
});

test("HyperFrames lists only permitted render names and statuses without returning signed media links", async () => {
  const account = {
    provider_id: "hyperframes-heygen",
    status: "connected",
    token_expires_at: null,
  };
  assert.equal(canReadConnection({ ...account, granted_scopes: [] }, "hyperframes-heygen"), false);
  assert.equal(
    canReadConnection({ ...account, granted_scopes: ["hyperframes:read"] }, "hyperframes-heygen"),
    true,
  );
  const result = await readConnection(
    "hyperframes-heygen",
    "Trailer",
    "fixture-only",
    async (url, init) => {
      assert.equal(url, "https://api.heygen.com/v3/hyperframes/renders?limit=10");
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-Api-Key"], "fixture-only");
      assert.equal(init.headers.Authorization, undefined);
      return Response.json({
        data: [
          {
            render_id: "hfr_fixture",
            title: "Demo Trailer",
            status: "completed",
            video_url: "private",
            failure_message: "private",
          },
          { render_id: "hfr_second", title: "Other", status: "queued" },
        ],
        next_token: "private",
      });
    },
  );
  assert.deepEqual(result.results, [
    { id: "hfr_fixture", title: "Demo Trailer", snippet: "completed", url: null },
  ]);
  await assert.rejects(
    readConnection(
      "hyperframes-heygen",
      "recent",
      "fixture-only",
      async () => new Response(null, { status: 403 }),
    ),
    /connection_permission_required/,
  );
});

test("Meltwater returns saved-search metadata and omits the search query, with no provider writes", async () => {
  const reply = await readConnection("meltwater", "Training", "fake-token", async (url, init) => {
    assert.equal(url, "https://api.meltwater.com/v3/searches");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.apikey, "fake-token");
    return Response.json({
      searches: [
        { id: 1, name: "Training news", updated: "2026-11-19T00:00:00Z", query: "private" },
        { id: 2, name: "Other", query: "private" },
      ],
    });
  });
  assert.deepEqual(reply.results, [
    { id: "1", title: "Training news", snippet: "2026-11-19T00:00:00Z", url: null },
  ]);
});

test("Vercel keeps the selected team server-bound and rejects URL or team injection in the query", async () => {
  const { token } = prepareKeyCredential("vercel", { apiKey: "fake-token", teamId: "team_demo" });
  assert.throws(
    () => connectionReadRequest("vercel", "prj_demo&teamId=team_other", token),
    /invalid_connection_query/,
  );
  const reply = await readConnection("vercel", "prj_demo", token, async (target, init) => {
    const url = new URL(target);
    assert.equal(
      url.href,
      "https://api.vercel.com/v7/deployments?teamId=team_demo&limit=10&projectId=prj_demo",
    );
    assert.equal(init.headers.Authorization, "Bearer fake-token");
    return Response.json({
      deployments: [
        {
          uid: "dpl_one",
          name: "web",
          readyState: "READY",
          target: "production",
          url: "private",
          meta: { secret: "private" },
        },
      ],
    });
  });
  assert.deepEqual(reply.results, [
    { id: "dpl_one", title: "web", snippet: "READY · production", url: null },
  ]);
});

test("Mixpanel uses the stored region, project and Data View, and filters out mismatched cohort records", async () => {
  const input = {
    apiKey: "fake-token",
    username: "fixture",
    region: "eu",
    projectId: "42",
    workspaceId: "110",
  };
  assert.throws(
    () => prepareKeyCredential("mixpanel", { ...input, region: "eu.example.com" }),
    /invalid_connection_credential/,
  );
  assert.throws(
    () => prepareKeyCredential("mixpanel", { ...input, username: "user:pass" }),
    /invalid_connection_credential/,
  );
  const { token } = prepareKeyCredential("mixpanel", input);
  const reply = await readConnection("mixpanel", "recent", token, async (url, init) => {
    assert.equal(
      url,
      "https://eu.mixpanel.com/api/query/cohorts/list?project_id=42&workspace_id=110",
    );
    assert.equal(init.method, "POST");
    assert.equal(init.body, undefined);
    assert.equal(
      init.headers.Authorization,
      "Basic " + Buffer.from("fixture:fake-token").toString("base64"),
    );
    return Response.json([
      { id: 1, name: "Training cohort", count: 5, description: "private", project_id: 42 },
      { id: 2, name: "Other account", count: 100, project_id: 43 },
    ]);
  });
  assert.deepEqual(reply.results, [
    { id: "1", title: "Training cohort", snippet: "5 users", url: null },
  ]);
});

test("eToro uses both keys only for the real account portfolio read and selects aggregate values", async () => {
  const { token } = prepareKeyCredential("etoro", {
    apiKey: "fake-token",
    userKey: "fixture-user-key",
  });
  assert.throws(
    () => connectionReadRequest("etoro", "place order", token),
    /invalid_connection_query/,
  );
  const reply = await readConnection("etoro", "portfolio", token, async (url, init) => {
    assert.equal(url, "https://public-api.etoro.com/api/v1/trading/info/aggregate-portfolio");
    assert.equal(init.method, "GET");
    assert.equal(init.headers["x-api-key"], "fake-token");
    assert.equal(init.headers["x-user-key"], "fixture-user-key");
    assert.match(init.headers["x-request-id"], /^[a-f0-9-]{36}$/u);
    return Response.json({
      accountCurrency: "USD",
      accountTotals: { accountTotalValue: 102.5, accountBalance: 40, accountCurrentPnl: -1.5 },
      instrumentAggregates: [{ name: "private" }],
    });
  });
  assert.deepEqual(
    reply.results.map(({ snippet }) => snippet),
    ["102.5 USD", "40 USD", "-1.5 USD"],
  );
  assert.doesNotMatch(JSON.stringify(reply), /private|fixture-user-key/);
});

test("upcoming Outlook events use a bounded seven-day calendar view without a subject filter", () => {
  const req = connectionReadRequest("outlook-calendar", "upcoming", "fake-token");
  const url = new URL(req.url);
  assert.equal(
    url.origin + url.pathname,
    "https://graph.microsoft.com/v1.0/me/calendar/calendarView",
  );
  const start = Date.parse(url.searchParams.get("startDateTime"));
  const end = Date.parse(url.searchParams.get("endDateTime"));
  assert.ok(Math.abs(start - Date.now()) < 10_000);
  assert.equal(end - start, 7 * 24 * 60 * 60 * 1000);
  assert.equal(url.searchParams.get("$filter"), null);
  assert.equal(url.searchParams.get("$top"), "10");
  assert.equal(url.searchParams.get("$select"), "id,subject,start,end,webLink");
  assert.equal(req.init.method, "GET");
});
