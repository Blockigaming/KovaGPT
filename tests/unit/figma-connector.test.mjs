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

test("Figma lookup requires file metadata permission and exact OAuth origin", () => {
  assert.equal(CONNECTION_FLOWS.figma.provider, "figma");
  assert.deepEqual(CONNECTION_FLOWS.figma.scopes, ["file_metadata:read"]);
  assert.equal(
    connectionAuthorizationUrl("figma", "https://www.figma.com/oauth?state=bound"),
    "https://www.figma.com/oauth?state=bound",
  );
  assert.equal(connectionAuthorizationUrl("figma", "https://evil.example/oauth"), null);
  const account = {
    provider_id: "figma",
    status: "connected",
    granted_scopes: ["current_user:read", "file_metadata:read"],
    token_expires_at: null,
  };
  assert.equal(canReadConnection(account, "figma"), true);
  assert.equal(
    canReadConnection({ ...account, granted_scopes: ["current_user:read"] }, "figma"),
    false,
  );
});

test("Figma file references are parsed as keys, never arbitrary request destinations", () => {
  const key = "MyFigmaFileKey123";
  for (const query of [
    key,
    "https://www.figma.com/design/" + key + "/Example?node-id=123",
    "https://figma.com/file/" + key + "/Example",
  ]) {
    const request = connectionReadRequest("figma", query, "fake-token");
    assert.equal(request.url, "https://api.figma.com/v1/files/" + key + "/meta");
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.body, undefined);
  }
  for (const query of [
    "https://evil.example/design/MyFigmaFileKey123",
    "http://www.figma.com/design/MyFigmaFileKey123",
    "https://someone@www.figma.com/design/MyFigmaFileKey123",
    "../../relative",
  ]) {
    assert.throws(
      () => connectionReadRequest("figma", query, "fake-token"),
      /invalid_figma_file_key/,
    );
  }
});

test("Figma metadata read discards creator, thumbnails and unexpected links", async () => {
  const result = await readConnection("figma", "MyFigmaFileKey123", "fake-token", async () =>
    Response.json({
      file: {
        name: "Product wireframes",
        last_touched_at: "2026-11-08T13:00:00Z",
        url: "https://evil.example/collect",
        creator: { email: "private-person@example.com" },
        thumbnail_url: "https://figma.com/secret.png",
        role: "owner",
      },
      access_token: "must-not-leak",
    }),
  );
  assert.equal(result.service, "Figma");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "MyFigmaFileKey123");
  assert.equal(result.results[0].title, "Product wireframes");
  assert.equal(result.results[0].url, null);
  assert.equal(result.results[0].snippet, "2026-11-08T13:00:00Z");
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-leak|private-person|secret\.png|evil\.example/,
  );
});

test("Figma token and refresh exchanges use server-side Basic auth with PKCE", () => {
  const input = {
    providerId: "figma",
    clientId: "client",
    clientSecret: "secret",
    code: "code",
    redirectUri: "https://kovagpt.com/api/integrations/oauth/callback/figma",
    verifier: "pkce-verifier",
  };
  const req = oauthTokenRequest(input);
  assert.equal(req.method, "POST");
  assert.equal(
    req.headers.Authorization,
    "Basic " + Buffer.from("client:secret").toString("base64"),
  );
  assert.equal(req.body.get("grant_type"), "authorization_code");
  assert.equal(req.body.get("code_verifier"), "pkce-verifier");
  assert.equal(req.body.get("client_id"), null);
  assert.throws(
    () => oauthTokenRequest({ ...input, verifier: undefined }),
    /oauth_pkce_verifier_missing/,
  );
  const refreshed = oauthRefreshRequest({
    providerId: "figma",
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "rotating",
  });
  assert.equal(refreshed.body.get("grant_type"), "refresh_token");
  assert.equal(refreshed.body.get("refresh_token"), "rotating");
  assert.equal(refreshed.body.get("client_id"), null);
  assert.equal(refreshed.headers.Authorization, req.headers.Authorization);
});
