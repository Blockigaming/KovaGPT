import assert from "node:assert/strict";
import test from "node:test";
import {
  githubTokenRefreshRequest,
  selectRotatedGithubTokens,
} from "../../src/lib/github-token-refresh-request.mjs";

test("GitHub token refresh is a confidential, nonredirecting POST to the exact provider endpoint", () => {
  const request = githubTokenRefreshRequest("client", "secret", "rotating-refresh-token");
  assert.equal(request.url, "https://github.com/login/oauth/access_token");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.headers.Accept, "application/json");
  assert.equal(request.init.body.get("client_id"), "client");
  assert.equal(request.init.body.get("client_secret"), "secret");
  assert.equal(request.init.body.get("grant_type"), "refresh_token");
  assert.equal(request.init.body.get("refresh_token"), "rotating-refresh-token");
  assert.equal(request.init.body.get("scope"), null);
  assert.ok(request.init.signal instanceof AbortSignal);
});

test("Missing client credentials and refresh credentials fail before a request", () => {
  for (const args of [
    ["", "secret", "refresh"],
    ["client", "", "refresh"],
    ["client", "secret", ""],
  ])
    assert.throws(() => githubTokenRefreshRequest(...args), /github_refresh_not_configured/);
});

test("GitHub refresh requires BOTH new tokens and bounded expiry before rotation", () => {
  const pair = {
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 28800,
    token_type: "bearer",
  };
  assert.deepEqual(selectRotatedGithubTokens(pair), {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresIn: 28800,
  });
  for (const bad of [
    null,
    { ...pair, refresh_token: undefined },
    { ...pair, access_token: undefined },
    { ...pair, expires_in: null },
    { ...pair, expires_in: 0 },
    { ...pair, expires_in: 90000000 },
    { ...pair, token_type: "unknown" },
    { ...pair, error: "bad_refresh_token" },
  ])
    assert.throws(() => selectRotatedGithubTokens(bad), /github_refresh_invalid_response/);
});
