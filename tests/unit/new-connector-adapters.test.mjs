import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  approvedMcpServers,
  isPublicMcpAddress,
} from "../../src/integrations/approved-mcp-servers.server.mjs";
import {
  connectionAuthorizationUrl,
  REVIEWED_MCP_WRITE_SCOPE,
  TANA_MCP_RESOURCE,
} from "../../src/integrations/connection-flows.mjs";
import { readConnection } from "../../src/integrations/connection-read.server.mjs";
import { prepareKeyCredential } from "../../src/integrations/key-connection-credential.server.mjs";
import {
  readMcpConnection,
  runReviewedMcpWrite,
  runTanaProposal,
  tanaProposalSchema,
} from "../../src/integrations/mcp-provider-read.server.mjs";
import {
  oauthRefreshRequest,
  oauthTokenRequest,
  selectOAuthTokens,
} from "../../src/integrations/oauth-token-request.server.mjs";

function credential(provider, fields) {
  return prepareKeyCredential(provider, fields).token;
}

test("IBKR requests the selected Flex report and follows only a numeric reference on its fixed endpoint", async () => {
  const token = credential("interactive-brokers", { apiKey: "452002018828", queryId: "294320" });
  const cases = [
    [
      "SendRequest",
      "294320",
      `<FlexStatementResponse><Status>Success</Status><ReferenceCode>0123</ReferenceCode><Url>https://untrusted.test/?credential=private</Url></FlexStatementResponse>`,
    ],
    [
      "GetStatement",
      "0123",
      `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>`,
    ],
    [
      "GetStatement",
      "0123",
      `<FlexQueryResponse><FlexStatements><FlexStatement accountId="private"><OpenPositions><OpenPosition symbol="EXAMPLE" currency="USD" position="-1.5" accountId="private" /></OpenPositions></FlexStatement></FlexStatements></FlexQueryResponse>`,
    ],
  ];
  let checks = 0;
  const result = await readConnection(
    "interactive-brokers",
    "positions",
    token,
    async (input, init) => {
      const [operation, id, body] = cases.shift();
      const url = new URL(input);
      assert.equal(url.origin, "https://ndcdyn.interactivebrokers.com");
      assert.equal(url.pathname, "/AccountManagement/FlexWebService/" + operation);
      assert.deepEqual(Object.fromEntries(url.searchParams), { t: "452002018828", q: id, v: "3" });
      assert.equal(init.redirect, "error");
      return new Response(body);
    },
    {
      beforeRequest: async () => {
        checks++;
      },
    },
  );
  assert.equal(checks, 3);
  assert.deepEqual(result.results, [
    { id: "1", title: "EXAMPLE", snippet: "Quantity -1.5 · USD", url: null },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|452002018828/);
});

test("IBKR rejects expired tokens, arbitrary references and XML declarations before requesting another URL", async () => {
  const token = credential("interactive-brokers", { apiKey: "452002018828", queryId: "294320" });
  for (const [payload, reason] of [
    [
      "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode></FlexStatementResponse>",
      /connection_reauthorization_required/,
    ],
    [
      "<FlexStatementResponse><Status>Success</Status><ReferenceCode>https://untrusted.test</ReferenceCode></FlexStatementResponse>",
      /invalid_connection_response/,
    ],
    ["<!DOCTYPE outside><FlexStatementResponse/>", /invalid_connection_response/],
  ]) {
    let calls = 0;
    await assert.rejects(
      readConnection("interactive-brokers", "recent", token, async () => {
        calls++;
        return new Response(payload);
      }),
      reason,
    );
    assert.equal(calls, 1);
  }
});

test("S&P exchanges dedicated API credentials and returns only licensed company match fields", async () => {
  const token = credential("sp-global", {
    apiKey: "private password",
    username: "example@tenant.test",
  });
  const query = 'A & "B"';
  let count = 0;
  const result = await readConnection("sp-global", query, token, async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api-ciq.marketintelligence.spglobal.com");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    if (++count === 1) {
      assert.equal(url.pathname, "/gdsapi/rest/authenticate/api/v1/token");
      assert.deepEqual(Object.fromEntries(init.body), {
        username: "example@tenant.test",
        password: "private password",
      });
      return Response.json({ token_type: "bearer", access_token: "private-access-token" });
    }
    assert.equal(url.pathname, "/gdsapi/rest/v3/clientservice.json");
    assert.equal(init.headers.Authorization, "Bearer private-access-token");
    assert.doesNotMatch(String(init.body), /private|tenant\.test/);
    assert.equal(JSON.parse(init.body).inputRequests[0].identifier, query);
    return Response.json({
      GDSSDKResponse: [
        {
          Mnemonic: "KL_PRO_ENTITY_ID_NAME_QUICK_MATCH",
          Headers: [
            "UID",
            "CIQCOMPANYID",
            "COMPANYNAME",
            "COUNTRYNAME",
            "SIMPLE_INDUSTRY",
            "ADDRESS",
          ],
          Rows: [{ Row: ["1", "IQ1234", "Fixture company", "US", "Technology", "private"] }],
          ErrMsg: "",
        },
      ],
    });
  });
  assert.equal(count, 2);
  assert.deepEqual(result.results, [
    { id: "IQ1234", title: "Fixture company", snippet: "US · Technology", url: null },
  ]);
});

test("a permission change between the S&P token exchange and data request prevents the second network call", async () => {
  const token = credential("sp-global", { apiKey: "private-fixture", username: "owner" });
  let calls = 0;
  await assert.rejects(
    readConnection(
      "sp-global",
      "Example",
      token,
      async () => {
        calls++;
        return Response.json({ token_type: "Bearer", access_token: "private-access-token" });
      },
      {
        beforeRequest: async () => {
          if (calls) throw new Error("connection_changed_or_expired");
        },
      },
    ),
    /connection_changed_or_expired/,
  );
  assert.equal(calls, 1);
});

test("Webull signs only the configured account list and omits account IDs and secrets from results", async () => {
  const token = credential("webull", {
    apiKey: "fixture-secret",
    appKey: "fixture-app-key",
    accessToken: "private-access-token",
    environment: "sandbox",
  });
  const result = await readConnection("webull", "accounts", token, async (url, init) => {
    assert.equal(url, "https://api.sandbox.webull.com/trading/accounts/list");
    const hdr = init.headers;
    assert.equal(hdr["x-version"], "v3");
    assert.equal(hdr["x-app-key"], "fixture-app-key");
    assert.equal(hdr["x-access-token"], "private-access-token");
    const canonical =
      "/trading/accounts/list&host=api.sandbox.webull.com&x-app-key=fixture-app-key" +
      "&x-signature-algorithm=HMAC-SHA1&x-signature-nonce=" +
      hdr["x-signature-nonce"] +
      "&x-signature-version=1.0&x-timestamp=" +
      hdr["x-timestamp"];
    assert.equal(
      hdr["x-signature"],
      createHmac("sha1", "fixture-secret&").update(encodeURIComponent(canonical)).digest("base64"),
    );
    assert.match(hdr["x-timestamp"], /T\d{2}:\d{2}:\d{2}Z$/u);
    assert.doesNotMatch(JSON.stringify(init), /fixture-secret/);
    return Response.json([
      { account_id: "private-account-id", account_type: "CASH", account_name: "private" },
    ]);
  });
  assert.deepEqual(result.results, [{ id: "1", title: "Account 1", snippet: "CASH", url: null }]);
  await assert.rejects(readConnection("webull", "place order", token), /invalid_connection_query/);
});

test("Wix binds access to the saved project and exposes only business name and locale", async () => {
  const token = credential("wix", { apiKey: "fixture-secret", clientId: "headless-project-1" });
  let count = 0;
  const result = await readConnection("wix", "site", token, async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.wixapis.com");
    if (++count === 1) {
      assert.equal(url.pathname, "/oauth2/token");
      assert.deepEqual(JSON.parse(init.body), {
        grant_type: "client_credentials",
        client_id: "headless-project-1",
        client_secret: "fixture-secret",
      });
      return Response.json({ access_token: "private-access-token", token_type: "Bearer" });
    }
    assert.equal(init.headers.Authorization, "private-access-token");
    assert.equal(url.pathname, "/site-properties/v4/properties");
    assert.deepEqual(url.searchParams.getAll("fields.paths"), ["businessName", "locale"]);
    return Response.json({
      version: "42",
      properties: {
        businessName: "Sample site",
        locale: { languageCode: "en", country: "US" },
        email: "private",
      },
    });
  });
  assert.equal(count, 2);
  assert.deepEqual(result.results, [
    { id: "site-properties", title: "Sample site", snippet: "en-US", url: null },
  ]);
});

function mockMcp(expectedEndpoint, tool, queryField, value, annotation = true, writeReceipt) {
  const calls = [];
  const transport = async (url, init) => {
    assert.equal(url, expectedEndpoint);
    assert.equal(init.redirect, "error");
    assert.match(init.headers.Authorization, /^Bearer /u);
    if (init.method === "DELETE") {
      assert.equal(init.headers["Mcp-Session-Id"], "fixture-session");
      calls.push("close");
      return new Response(null, { status: 204 });
    }
    const rpc = JSON.parse(init.body);
    calls.push(rpc.method);
    assert.equal(rpc.jsonrpc, "2.0");
    if (rpc.method === "initialize") {
      assert.deepEqual(rpc.params.capabilities, {});
      return Response.json(
        {
          jsonrpc: "2.0",
          id: rpc.id,
          result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
        },
        { headers: { "Mcp-Session-Id": "fixture-session" } },
      );
    }
    assert.equal(init.headers["MCP-Protocol-Version"], "2025-06-18");
    assert.equal(init.headers["Mcp-Session-Id"], "fixture-session");
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (rpc.method === "tools/list")
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          tools: [
            {
              name: tool,
              annotations:
                typeof annotation === "boolean" ? { readOnlyHint: annotation } : annotation,
              inputSchema: {
                type: "object",
                properties: {
                  [queryField]: Array.isArray(value)
                    ? { type: "array", items: { type: "string" } }
                    : { type: "string" },
                },
                required: [queryField],
              },
            },
            { name: "deleteAll" },
          ],
        },
      });
    assert.equal(rpc.method, "tools/call");
    assert.deepEqual(rpc.params, { name: tool, arguments: { [queryField]: value } });
    return new Response(
      "event: message\r\ndata: " +
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            ...(writeReceipt ? { structuredContent: writeReceipt } : {}),
            content: [
              { type: "image", data: "private" },
              { type: "text", text: "Fixture result" },
            ],
          },
        }) +
        "\r\n\r\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  return { transport, calls };
}

test("Tana uses PKCE and sends the MCP resource on token issuance and renewal", () => {
  const auth = "https://login.tana.inc/oauth2/authorize?resource=test";
  assert.equal(connectionAuthorizationUrl("tana", auth), auth);
  assert.equal(connectionAuthorizationUrl("tana", "https://home.tana.inc/oauth2/authorize"), null);
  assert.equal(
    connectionAuthorizationUrl("tana", "https://home.tana.inc.evil.test/oauth/authorize"),
    null,
  );
  assert.equal(
    connectionAuthorizationUrl("tana", "https://home.tana.inc/redirect?next=evil.test"),
    null,
  );
  const input = {
    providerId: "tana",
    redirectUri: "https://kovagpt.com/callback",
    code: "code",
    clientId: "test-client",
    verifier: "s256-verifier",
    tokenClientAuth: "none",
  };
  assert.throws(
    () => oauthTokenRequest({ ...input, verifier: undefined }),
    /oauth_pkce_verifier_missing/,
  );
  const token = oauthTokenRequest(input);
  assert.equal(token.body.get("resource"), TANA_MCP_RESOURCE);
  assert.equal(token.body.get("code_verifier"), "s256-verifier");
  assert.equal(token.body.get("client_secret"), null);
  const refresh = oauthRefreshRequest({ ...input, refreshToken: "refresh" });
  assert.equal(refresh.body.get("resource"), TANA_MCP_RESOURCE);
  assert.equal(refresh.body.get("grant_type"), "refresh_token");
  assert.throws(
    () => selectOAuthTokens("tana", { access_token: "unknown", token_type: "Unknown" }),
    /oauth_access_token_missing/,
  );
});

test("Tana runs only the documented search tool and uses the initialized session across Streamable HTTP", async () => {
  const mock = mockMcp(TANA_MCP_RESOURCE, "searchItems", "queries", ["meeting"]);
  const result = await readConnection("tana", "meeting", "tana-fixture-token", mock.transport);
  assert.deepEqual(mock.calls, [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
    "close",
  ]);
  assert.deepEqual(result.results, [
    { id: "1", title: "Tana search result", snippet: "Fixture result", url: null },
  ]);
  assert.equal(result.limited, true);
});

test("Custom MCP checks the approved URL, unchanged binding and a declared read tool before any call", async () => {
  const entry = {
    id: "fixture",
    url: "https://docs.example.com/mcp",
    tool: "readDocs",
    queryField: "query",
  };
  for (const url of [
    "http://example.com/mcp",
    "https://127.0.0.1/mcp",
    "https://docs.example.com/mcp?token=private",
    "https://admin@docs.example.com/mcp",
    "https://docs.internal/mcp",
  ]) {
    assert.equal(approvedMcpServers(JSON.stringify([{ ...entry, url }])).size, 0);
  }
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "168.63.129.16",
    "10.0.0.1",
    "::ffff:127.0.0.1",
    "240.0.0.1",
  ]) {
    assert.equal(isPublicMcpAddress(ip), false);
  }
  assert.equal(isPublicMcpAddress("1.1.1.1"), true);
  const previous = process.env.KOVA_MCP_READ_SERVERS;
  try {
    process.env.KOVA_MCP_READ_SERVERS = JSON.stringify([entry]);
    const token = credential("custom-mcp", { apiKey: "mcp-fixture-token", serverId: "fixture" });
    const mock = mockMcp(entry.url, entry.tool, "query", "example");
    const result = await readMcpConnection(
      "custom-mcp",
      "example",
      token,
      fetch,
      undefined,
      mock.transport,
    );
    assert.equal(result.results[0].snippet, "Fixture result");
    const changed = mockMcp(entry.url, entry.tool, "query", "example", false);
    await assert.rejects(
      readMcpConnection("custom-mcp", "example", token, fetch, undefined, changed.transport),
      /mcp_tool_changed/,
    );
    assert.deepEqual(changed.calls, [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "close",
    ]);
    process.env.KOVA_MCP_READ_SERVERS = JSON.stringify([
      { ...entry, url: "https://elsewhere.example.com/mcp" },
    ]);
    assert.throws(
      () => readMcpConnection("custom-mcp", "example", token, fetch, undefined, mock.transport),
      /connection_changed_or_expired/,
    );
  } finally {
    if (previous === undefined) delete process.env.KOVA_MCP_READ_SERVERS;
    else process.env.KOVA_MCP_READ_SERVERS = previous;
  }
});

test("Custom MCP writes require a linked tool binding, non-destructive schema, and server receipt", async () => {
  const entry = {
    id: "fixture",
    url: "https://docs.example.com/mcp",
    tool: "readDocs",
    queryField: "query",
    writeTool: "createNote",
    writeField: "text",
  };
  const env = process.env.KOVA_MCP_READ_SERVERS;
  const fields = { apiKey: "mcp-fixture-token", serverId: entry.id };
  try {
    process.env.KOVA_MCP_READ_SERVERS = JSON.stringify([entry]);
    const linked = prepareKeyCredential("custom-mcp", fields);
    assert.deepEqual(linked.addedScopes, [REVIEWED_MCP_WRITE_SCOPE]);
    const annotations = { readOnlyHint: false, destructiveHint: false };
    const mock = mockMcp(
      entry.url,
      entry.writeTool,
      entry.writeField,
      "Fixture note",
      annotations,
      { ok: true },
    );
    const assertAuthorized = async () => {};
    await assert.rejects(
      runReviewedMcpWrite(
        linked.token,
        "deleteAll",
        "Fixture note",
        assertAuthorized,
        mock.transport,
      ),
      /permission_required/u,
    );
    assert.deepEqual(mock.calls, []);
    assert.equal(
      await runReviewedMcpWrite(
        linked.token,
        entry.writeTool,
        "Fixture note",
        assertAuthorized,
        mock.transport,
      ),
      true,
    );
    assert.equal(mock.calls.filter((call) => call === "tools/call").length, 1);
    const destructive = mockMcp(entry.url, entry.writeTool, entry.writeField, "Fixture note", {
      ...annotations,
      destructiveHint: true,
    });
    await assert.rejects(
      runReviewedMcpWrite(
        linked.token,
        entry.writeTool,
        "Fixture note",
        assertAuthorized,
        destructive.transport,
      ),
      /tool_changed/u,
    );
    assert.equal(destructive.calls.includes("tools/call"), false);
    process.env.KOVA_MCP_READ_SERVERS = JSON.stringify([{ ...entry, writeField: "replacement" }]);
    await assert.rejects(
      runReviewedMcpWrite(
        linked.token,
        entry.writeTool,
        "Fixture note",
        assertAuthorized,
        mock.transport,
      ),
      /permission_required/u,
    );
    const read = mockMcp(entry.url, entry.tool, entry.queryField, "example");
    assert.equal(
      (
        await readMcpConnection(
          "custom-mcp",
          "example",
          linked.token,
          fetch,
          undefined,
          read.transport,
        )
      ).results[0].snippet,
      "Fixture result",
    );
  } finally {
    if (env === undefined) delete process.env.KOVA_MCP_READ_SERVERS;
    else process.env.KOVA_MCP_READ_SERVERS = env;
  }
});

test("Tana validates the current createItems schema and only sends unapproved proposals", async () => {
  const calls = [];
  const token = "fixture-tana-token";
  const descriptor = {
    name: "createItems",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["title"],
            properties: { title: { type: "string", minLength: 1 } },
          },
        },
        autoApprove: { type: "boolean" },
      },
    },
  };
  async function transport(url, init) {
    assert.equal(url, TANA_MCP_RESOURCE);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    const { id, method, params } = JSON.parse(init.body);
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (method === "tools/call") calls.push(params);
    const result = {
      initialize: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
      "tools/list": { tools: [descriptor, { name: "approveProposals" }] },
      "tools/call": { structuredContent: { sessionUri: "tana:fixture-proposal" } },
    }[method];
    return Response.json({ jsonrpc: "2.0", id, result });
  }
  assert.deepEqual(JSON.parse(await tanaProposalSchema(token, transport)), descriptor.inputSchema);
  await assert.rejects(
    runTanaProposal(token, '{"items":[],"autoApprove":true}', transport),
    /invalid_tana_proposal/u,
  );
  await assert.rejects(
    runTanaProposal(token, '{"items":[{"title":7}]}', transport),
    /invalid_tana_proposal/u,
  );
  assert.deepEqual(calls, []);
  const items = [{ title: "Fixture document" }];
  assert.equal(
    await runTanaProposal(token, JSON.stringify({ items }), transport),
    "tana:fixture-proposal",
  );
  assert.deepEqual(calls, [{ name: "createItems", arguments: { items, autoApprove: false } }]);
});
