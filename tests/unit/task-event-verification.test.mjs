import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyTaskProviderEvent,
  verifyGooglePushToken,
} from "../../src/lib/task-event-verification.server.mjs";
const secret = "fixture-secret-with-enough-entropy";
const now = Date.parse("2026-09-05T12:00:00Z");
const encoder = new TextEncoder();
async function signature(body, prefix = "sha256") {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    prefix +
    "=" +
    [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
test("Slack verifies raw bytes, timestamp and app identity before admitting references", async () => {
  const payload = {
    api_app_id: "A12345678",
    team_id: "T12345678",
    type: "event_callback",
    event: {
      type: "message",
      channel: "C12345678",
      user: "U12345678",
      ts: "1788609600.000001",
      text: "private body",
    },
  };
  const body = JSON.stringify(payload),
    timestamp = String(now / 1000),
    headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": await signature(`v0:${timestamp}:${body}`, "v0"),
    };
  const config = { slackSecret: secret, slackAppId: "A12345678" };
  const result = await verifyTaskProviderEvent(
    "slack",
    new Request("https://example.test", { method: "POST", headers, body }),
    config,
    { now },
  );
  assert.equal(result.resource, "C12345678");
  assert.equal(result.scopeKey, "T12345678");
  assert.equal(JSON.stringify(result).includes("private body"), false);
  for (const invalid of [body + " ", JSON.stringify({ ...payload, api_app_id: "A99999999" })])
    await assert.rejects(
      verifyTaskProviderEvent(
        "slack",
        new Request("https://example.test", { method: "POST", headers, body: invalid }),
        config,
        { now },
      ),
    );
  await assert.rejects(
    verifyTaskProviderEvent(
      "slack",
      new Request("https://example.test", { method: "POST", headers, body }),
      config,
      { now: now + 301000 },
    ),
  );
});
test("Slack URL verification authenticates the challenge without requiring absent event-only fields", async () => {
  const body = JSON.stringify({ type: "url_verification", challenge: "challenge-value" }),
    timestamp = String(now / 1000);
  const result = await verifyTaskProviderEvent(
    "slack",
    new Request("https://example.test", {
      method: "POST",
      body,
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": await signature(`v0:${timestamp}:${body}`, "v0"),
      },
    }),
    { slackSecret: secret, slackAppId: "A12345678" },
    { now },
  );
  assert.deepEqual(result, { challenge: "challenge-value" });
});
test("GitHub ignores unsigned delivery IDs, rejects tampering and ignores pre-window replays", async () => {
  const payload = {
    action: "opened",
    number: 4,
    repository: { full_name: "Owner/Repo" },
    pull_request: {
      number: 4,
      updated_at: new Date(now - 1000).toISOString(),
      body: "private text",
    },
  };
  const body = JSON.stringify(payload),
    sig = await signature(body);
  const deliver = (delivery) =>
    verifyTaskProviderEvent(
      "github",
      new Request("https://example.test", {
        method: "POST",
        body,
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": delivery,
          "x-hub-signature-256": sig,
        },
      }),
      { githubSecret: secret },
      { now },
    );
  const a = await deliver("a"),
    b = await deliver("b");
  assert.equal(a.eventKey, b.eventKey);
  assert.equal(a.resource, "owner/repo");
  assert.equal(JSON.stringify(a).includes("private text"), false);
  await assert.rejects(
    verifyTaskProviderEvent(
      "github",
      new Request("https://example.test", {
        method: "POST",
        body: body + " ",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sig },
      }),
      { githubSecret: secret },
      { now },
    ),
  );
  assert.deepEqual(
    await verifyTaskProviderEvent(
      "github",
      new Request("https://example.test", {
        method: "POST",
        body,
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sig },
      }),
      { githubSecret: secret },
      { now: now + 86400000 },
    ),
    { ignored: true },
  );
});
test("Google PubSub tokens require valid RSA signature, issuer, audience and exact verified service account", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: "fixture-kid",
    alg: "RS256",
    use: "sig",
  };
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = {
    iss: "https://accounts.google.com",
    aud: "https://example.test/api/tasks/events/gmail",
    email: "push@project.iam.gserviceaccount.com",
    email_verified: true,
    sub: "123456789",
    iat: now / 1000 - 1,
    exp: now / 1000 + 3600,
  };
  const make = async (c = claims, h = { alg: "RS256", kid: "fixture-kid" }) => {
    const input = `${enc(h)}.${enc(c)}`;
    return `${input}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, encoder.encode(input))).toString("base64url")}`;
  };
  let fetches = 0;
  let returnedKeys = [jwk];
  const fetchImpl = async (url) => {
    assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
    fetches++;
    return Response.json({ keys: returnedKeys });
  };
  const config = { audience: claims.aud, serviceAccount: claims.email };
  assert.equal(await verifyGooglePushToken(await make(), config, { fetchImpl, now }), true);
  for (const wrong of [
    { ...claims, email: "other@project.iam.gserviceaccount.com" },
    { ...claims, email_verified: false },
    { ...claims, aud: "https://evil.test" },
    { ...claims, iss: "https://evil.test" },
    { ...claims, exp: now / 1000 - 1 },
  ])
    await assert.rejects(verifyGooglePushToken(await make(wrong), config, { fetchImpl, now }));
  const token = await make(),
    parts = token.split(".");
  parts[1] = enc({ ...claims, sub: "987654321" });
  await assert.rejects(verifyGooglePushToken(parts.join("."), config, { fetchImpl, now }));
  const body = JSON.stringify({
    subscription: "projects/project/subscriptions/fixture",
    message: {
      data: Buffer.from(
        JSON.stringify({ emailAddress: "PRIVATE@example.test", historyId: "12345678901234567890" }),
      ).toString("base64"),
    },
  });
  const event = await verifyTaskProviderEvent(
    "gmail",
    new Request("https://example.test", {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${token}` },
    }),
    {
      gmailAudience: claims.aud,
      gmailServiceAccount: claims.email,
      gmailSubscription: "projects/project/subscriptions/fixture",
    },
    { fetchImpl, now },
  );
  assert.match(event.scopeKey, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(event).includes("PRIVATE"), false);
  assert.equal(event.reference.historyHint, "12345678901234567890");
  assert.equal(fetches, 1);
  for (let index = 0; index < 3; index++)
    await assert.rejects(
      verifyGooglePushToken(await make(claims, { alg: "RS256", kid: `unknown-${index}` }), config, {
        fetchImpl,
        now,
      }),
    );
  await Promise.all(
    Array.from({ length: 10 }, async (_, index) =>
      assert.rejects(
        verifyGooglePushToken(
          await make(claims, { alg: "RS256", kid: `concurrent-${index}` }),
          config,
          { fetchImpl, now },
        ),
      ),
    ),
  );
  assert.equal(
    fetches,
    2,
    "one forced refresh is shared across sequential/concurrent invalid kids",
  );
  returnedKeys = [{ ...jwk, kid: "rotated-kid" }];
  assert.equal(
    await verifyGooglePushToken(await make(claims, { alg: "RS256", kid: "rotated-kid" }), config, {
      fetchImpl,
      now: now + 60_001,
    }),
    true,
  );
  assert.equal(fetches, 3, "a later legitimate key rotation can refresh once");
});
