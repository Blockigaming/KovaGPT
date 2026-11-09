import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  connectionAuthorizationUrl,
} from "../../src/integrations/connection-flows.mjs";
import {
  connectionReadRequest,
  readConnection,
} from "../../src/integrations/connection-read.server.mjs";
import {
  oauthTokenRequest,
  oauthRefreshRequest,
} from "../../src/integrations/oauth-token-request.server.mjs";

test("Canva is exposed as metadata-only service with exact authorization origin", () => {
  assert.equal(CONNECTION_FLOWS.canva.provider, "canva");
  assert.deepEqual(CONNECTION_FLOWS.canva.scopes, ["design:meta:read"]);
  assert.equal(
    connectionAuthorizationUrl("canva", "https://www.canva.com/api/oauth/authorize?state=ok"),
    "https://www.canva.com/api/oauth/authorize?state=ok",
  );
  assert.equal(
    connectionAuthorizationUrl("canva", "https://evil.example/api/oauth/authorize"),
    null,
  );
  assert.equal(
    connectionAuthorizationUrl("canva", "http://www.canva.com/api/oauth/authorize"),
    null,
  );
  const account = {
    provider_id: "canva",
    status: "connected",
    granted_scopes: ["design:meta:read"],
    token_expires_at: null,
  };
  assert.equal(canReadConnection(account, "canva"), true);
  assert.equal(canReadConnection({ ...account, granted_scopes: [] }, "canva"), false);
  assert.equal(canReadConnection({ ...account, status: "revoked" }, "canva"), false);
});

test("Canva design queries are bounded and cannot redirect to arbitrary hosts", () => {
  const query = "Summer poster & brochure";
  const req = connectionReadRequest("canva", query, "fake-token");
  const url = new URL(req.url);
  assert.equal(url.origin + url.pathname, "https://api.canva.com/rest/v1/designs");
  assert.equal(url.searchParams.get("query"), query);
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(req.init.method, "GET");
  assert.equal(req.init.redirect, "error");
  assert.equal(req.init.body, undefined);
  assert.equal(req.init.headers.Authorization, "Bearer fake-token");
  assert.throws(
    () => connectionReadRequest("canva", "x".repeat(256), "fake-token"),
    /invalid_connection_query/,
  );
});

test("Canva strips temporary signed links, thumbnails and other sensitive response fields", async () => {
  const result = await readConnection("canva", "Summer", "fake-token", async () =>
    Response.json({
      continuation: "secret-pagination-token",
      items: Array.from({ length: 20 }, (_, i) => ({
        id: "design-" + i,
        title: "Summer " + i,
        design_types: ["presentation"],
        urls: { view_url: "https://www.canva.com/api/design/sensitive-capability/view" },
        thumbnail: { url: "https://document-export.canva.com/private.jpg" },
        owner: { user_id: "private-user-id" },
        access_token: "secret-token",
      })),
    }),
  );
  assert.equal(result.service, "Canva");
  assert.equal(result.results.length, 10);
  assert.equal(result.results[0].title, "Summer 0");
  assert.equal(result.results[0].id, "design-0");
  assert.equal(result.results[0].snippet, "presentation");
  assert.equal(result.results[0].url, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sensitive-capability|secret-token|secret-pagination-token|private-user-id|private\.jpg/,
  );
});

test("Canva token exchange requires PKCE and confidential Basic authentication", () => {
  const input = {
    providerId: "canva",
    clientId: "client",
    clientSecret: "secret",
    code: "one-time-code",
    redirectUri: "https://kovagpt.com/api/integrations/oauth/callback/canva",
    verifier: "verifier-for-test",
  };
  const req = oauthTokenRequest(input);
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(
    req.headers.Authorization,
    "Basic " + Buffer.from("client:secret").toString("base64"),
  );
  assert.equal(req.body.get("grant_type"), "authorization_code");
  assert.equal(req.body.get("code_verifier"), input.verifier);
  assert.equal(req.body.get("client_secret"), null);
  assert.throws(
    () => oauthTokenRequest({ ...input, verifier: undefined }),
    /oauth_pkce_verifier_missing/,
  );
  const refresh = oauthRefreshRequest({
    providerId: "canva",
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "rotating",
  });
  assert.equal(refresh.body.get("grant_type"), "refresh_token");
  assert.equal(refresh.body.get("refresh_token"), "rotating");
  assert.equal(refresh.headers.Authorization, req.headers.Authorization);
});
