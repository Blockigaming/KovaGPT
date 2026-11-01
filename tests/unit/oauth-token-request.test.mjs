import test from "node:test";
import assert from "node:assert/strict";
import {
  oauthTokenRequest,
  oauthRefreshRequest,
  selectRefreshTokens,
} from "../../src/integrations/oauth-token-request.server.mjs";

const input = {
  clientId: "example-client",
  clientSecret: "example-secret+&=",
  code: "example-code+&=",
  redirectUri: "https://example.com/api/integrations/oauth/callback/notion",
};

test("Notion exchanges use Basic authentication and JSON without body credentials", async () => {
  const request = new Request(
    "https://api.notion.com/v1/oauth/token",
    oauthTokenRequest({
      ...input,
      providerId: "notion",
    }),
  );
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("Content-Type"), "application/json");
  assert.equal(request.headers.get("Notion-Version"), "2022-06-28");
  assert.equal(
    request.headers.get("Authorization"),
    `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
  );
  assert.deepEqual(await request.json(), {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
});

test("other adapters retain form encoding and PKCE through HTTP serialization", async () => {
  for (const providerId of ["microsoft", "github", "slack", "linear", "dropbox", "box"]) {
    const request = new Request(
      "https://example.com/token",
      oauthTokenRequest({
        ...input,
        providerId,
        verifier: "test-verifier+&=",
      }),
    );
    assert.match(request.headers.get("Content-Type"), /^application\/x-www-form-urlencoded/);
    assert.equal(request.headers.get("Authorization"), null);
    const form = new URLSearchParams(await request.text());
    assert.equal(form.get("client_id"), input.clientId);
    assert.equal(form.get("client_secret"), input.clientSecret);
    assert.equal(form.get("code"), input.code);
    assert.equal(form.get("redirect_uri"), input.redirectUri);
    assert.equal(form.get("code_verifier"), "test-verifier+&=");
  }
});

test("missing client credentials fail before constructing a provider request", () => {
  for (const providerId of ["notion", "microsoft"]) {
    for (const field of ["clientId", "clientSecret"]) {
      assert.throws(
        () => oauthTokenRequest({ ...input, providerId, [field]: undefined }),
        /provider_not_configured/,
      );
    }
  }
});

test("Notion refreshes serialize Basic authentication and JSON without body credentials", async () => {
  const init = oauthRefreshRequest({
    providerId: "notion",
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: "example-refresh+&=",
  });
  const request = new Request("https://api.notion.com/v1/oauth/token", init);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("Content-Type"), "application/json");
  assert.equal(request.headers.get("Notion-Version"), "2022-06-28");
  assert.equal(
    request.headers.get("Authorization"),
    "Basic " + Buffer.from(input.clientId + ":" + input.clientSecret).toString("base64"),
  );
  assert.deepEqual(await request.json(), {
    grant_type: "refresh_token",
    refresh_token: "example-refresh+&=",
  });
  assert.equal(init.redirect, "error");
  assert.ok(init.signal instanceof AbortSignal);
});

test("Notion refreshes require a rotated token pair without inventing an expiry", () => {
  assert.deepEqual(
    selectRefreshTokens("notion", {
      access_token: "example-renewed",
      refresh_token: "example-rotated",
    }),
    { access_token: "example-renewed", refresh_token: "example-rotated" },
  );
  for (const refresh_token of [undefined, ""])
    assert.throws(
      () => selectRefreshTokens("notion", { access_token: "example-renewed", refresh_token }),
      /refresh_token_missing/,
    );
  assert.throws(
    () => selectRefreshTokens("microsoft", { access_token: "example-renewed" }),
    /refresh_expiry_missing/,
  );
});

test("Notion refreshes reject missing credentials before creating a request", () => {
  const input = {
    providerId: "notion",
    clientId: "example-client",
    clientSecret: "example-secret",
    refreshToken: "example-refresh",
  };
  for (const field of ["clientId", "clientSecret", "refreshToken"])
    assert.throws(
      () => oauthRefreshRequest({ ...input, [field]: undefined }),
      /refresh_not_configured/,
    );
});
