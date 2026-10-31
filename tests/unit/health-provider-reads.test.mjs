import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedHealthScopes,
  healthReadRequest,
  readHealthSummary,
} from "../../src/health/health-read.server.mjs";
import { oauthRefreshRequest } from "../../src/integrations/oauth-token-request.server.mjs";
import {
  CONNECTION_FLOWS,
  connectionAuthorizationUrl,
} from "../../src/integrations/connection-flows.mjs";
const now = Date.parse("2026-10-31T12:00:00Z");

test("health requests are fixed HTTPS GETs with bounded dates and provider API v2 paths", () => {
  const expected = { oura: "api.ouraring.com", whoop: "api.prod.whoop.com" };
  for (const provider of Object.keys(expected))
    for (const metric of ["sleep", "recovery", "activity"]) {
      const request = healthReadRequest(provider, metric, "fixture-token", now);
      const url = new URL(request.url);
      assert.equal(url.hostname, expected[provider]);
      assert.equal(url.protocol, "https:");
      assert.equal(request.init.method, "GET");
      assert.equal(request.init.redirect, "error");
      assert.equal(request.init.headers.Authorization, "Bearer fixture-token");
      assert.match(url.pathname, /\/v2\//);
      assert.equal(
        url.searchParams.get(provider === "oura" ? "start_date" : "start"),
        provider === "oura" ? "2026-10-24" : "2026-10-24T12:00:00.000Z",
      );
    }
  for (const bad of ["__proto__", "constructor", "https://attacker.example"])
    assert.throws(() => healthReadRequest(bad, "sleep", "t"), /unsupported_health_read/);
  assert.throws(
    () => healthReadRequest("oura", "../../../personal_info", "t"),
    /unsupported_health_read/,
  );
  assert.throws(() => healthReadRequest("oura", "sleep", "a\r\nb"), /invalid_health_token/);
});
test("Oura scope omission does not promote denied permissions to granted", async () => {
  const granted = await confirmedHealthScopes(
    "oura",
    ["personal", "daily"],
    undefined,
    "token",
    async () => new Response(null, { status: 403 }),
  );
  assert.deepEqual(granted, ["personal"]);
  assert.deepEqual(
    await confirmedHealthScopes("oura", ["daily"], undefined, "token", async () =>
      Response.json({ data: [] }),
    ),
    ["personal", "daily"],
  );
  assert.deepEqual(
    await confirmedHealthScopes("whoop", ["read:sleep"], "read:profile", "token", async () => {
      throw new Error("must not probe");
    }),
    ["read:profile"],
  );
});

test("a cancelled health consent cannot start a scope-probing data request", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      confirmedHealthScopes(
        "oura",
        ["daily"],
        undefined,
        "token",
        async () => {
          calls++;
          return Response.json({ data: [] });
        },
        async () => {
          throw new Error("consent_withdrawn");
        },
      ),
    /consent_withdrawn/,
  );
  assert.equal(calls, 0);
});
test("health read summaries include only granted categories and explicit safe summary fields", async () => {
  let checks = 0,
    calls = 0;
  const result = await readHealthSummary(
    "whoop",
    ["read:recovery"],
    "fixture-token",
    async () => {
      checks++;
    },
    async () => {
      calls++;
      return Response.json({
        records: [
          {
            created_at: "2026-10-30T00:00:00Z",
            score: { recovery_score: 80, resting_heart_rate: 55, hrv_rmssd_milli: 99 },
            email: "must-not-return",
            access_token: "secret",
          },
        ],
        next_token: "next",
      });
    },
    now,
  );
  assert.equal(calls, 1);
  assert.equal(checks, 3);
  assert.deepEqual(result.missing, ["sleep", "activity"]);
  assert.equal(result.summaries[0].score, 80);
  assert.equal(result.summaries[0].restingHeartRate, 55);
  assert.equal(result.limited, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /email|access_token|must-not-return|hrv|secret|fixture-token/,
  );
});
test("health revocation during a request prevents data release and further requests", async () => {
  let revoked = false,
    calls = 0;
  await assert.rejects(
    () =>
      readHealthSummary(
        "oura",
        ["daily"],
        "token",
        async () => {
          if (revoked) throw new Error("revoked");
        },
        async () => {
          calls++;
          revoked = true;
          return Response.json({ data: [{ score: 90, day: "2026-10-30" }] });
        },
        now,
      ),
    /revoked/,
  );
  assert.equal(calls, 1);
});
test("missing scopes, oversized/malformed responses and provider failures fail closed", async () => {
  await assert.rejects(
    () =>
      readHealthSummary(
        "oura",
        [],
        "token",
        async () => {},
        async () => {
          throw new Error("must not fetch");
        },
      ),
    /health_permission_required/,
  );
  for (const [response, error] of [
    [new Response(null, { status: 401 }), "health_reconnect_required"],
    [new Response(null, { status: 403 }), "health_access_denied"],
    [new Response("x".repeat(256 * 1024 + 1)), "health_response_rejected"],
    [Response.json({ data: {} }), "health_response_rejected"],
  ]) {
    await assert.rejects(
      () =>
        readHealthSummary(
          "oura",
          ["daily"],
          "token",
          async () => {},
          async () => response,
        ),
      new RegExp(error),
    );
  }
});
test("health OAuth refresh includes WHOOP offline scope; health is absent from automatic chat tools", () => {
  for (const providerId of ["oura", "whoop"]) {
    const request = oauthRefreshRequest({
      providerId,
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh",
    });
    assert.equal(request.body.get("grant_type"), "refresh_token");
    assert.equal(request.redirect, "error");
    assert.equal(request.body.get("scope"), providerId === "whoop" ? "offline" : null);
    assert.equal(
      Object.values(CONNECTION_FLOWS).some((flow) => flow.provider === providerId),
      false,
    );
  }
  assert.equal(
    connectionAuthorizationUrl("oura", "https://cloud.ouraring.com/oauth/authorize?state=x"),
    "https://cloud.ouraring.com/oauth/authorize?state=x",
  );
  assert.equal(
    connectionAuthorizationUrl("whoop", "https://api.prod.whoop.com/oauth/oauth2/auth?state=x"),
    "https://api.prod.whoop.com/oauth/oauth2/auth?state=x",
  );
  assert.equal(
    connectionAuthorizationUrl("oura", "https://attacker.example/oauth/authorize"),
    null,
  );
});
