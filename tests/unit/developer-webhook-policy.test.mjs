import assert from "node:assert/strict";
import test from "node:test";
import {
  developerWebhookSecret,
  developerWebhookSignature,
  parseDeveloperWebhookRequest,
  publicWebhookIPv4,
  verifyDeveloperWebhook,
  webhookDestination,
} from "../../src/lib/pricing/developer-webhook-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const url = "https://hooks.example.com/kova";
const allowed = [url];
const endpoint = {
  id,
  project_id: "22222222-2222-4222-8222-222222222222",
  api_key_id: "33333333-3333-4333-8333-333333333333",
  secret_nonce: "44444444-4444-4444-8444-444444444444",
  generation: 1,
};
test("only exact approved HTTPS destinations are allowed", () => {
  assert.equal(webhookDestination(url, allowed).href, url);
  for (const value of [
    "http://hooks.example.com/kova",
    "https://hooks.example.com/kova?token=private",
    "https://hooks.example.com:444/kova",
    "https://user@hooks.example.com/kova",
    "https://hooks.example.com/kova#x",
    "https://127.0.0.1/kova",
    "https://service.internal/kova",
    "https://hooks.example.com/other",
  ])
    assert.throws(() => webhookDestination(value, allowed), /webhook_invalid/);
});
test("DNS answers must be canonical public IPv4 addresses", () => {
  for (const value of ["8.8.8.8", "1.1.1.1", "93.184.216.34"])
    assert.equal(publicWebhookIPv4(value), true);
  for (const value of [
    "0.0.0.0", "127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1",
    "192.168.1.1", "100.64.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1",
    "::ffff:127.0.0.1", "010.0.0.1", "8.8.8.256",
  ])
    assert.equal(publicWebhookIPv4(value), false, value);
});
test("scoped resource operations reject extra fields and ambiguous queries", () => {
  const create = { operation: "create", id, url, events: ["request.settled"] };
  const parse = (method, query = "", body) =>
    parseDeveloperWebhookRequest(method, new URLSearchParams(query), body, allowed);
  assert.equal(parse("POST", "", create).input.url, url);
  assert.equal(parse("GET", "id=" + id + "&deliveries=true").operation, "deliveries");
  assert.equal(parse("DELETE", "id=" + id).operation, "delete");
  for (const patch of [
    { events: ["request.settled", "request.settled"] },
    { events: ["billing.private"] },
    { owner_id: id },
    { headers: { authorization: "x" } },
  ])
    assert.throws(() => parse("POST", "", { ...create, ...patch }), /webhook_invalid/);
  assert.throws(() => parse("GET", "id=" + id + "&id=" + id), /webhook_invalid/);
});
test("HMAC binds event, body and timestamp; rotation and recreation change the key", () => {
  const master = "a".repeat(64);
  const secret = developerWebhookSecret(master, endpoint);
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, developerWebhookSecret(master, { ...endpoint, generation: 2 }));
  assert.notEqual(secret, developerWebhookSecret(master, { ...endpoint, secret_nonce: endpoint.api_key_id }));
  const timestamp = 1795651200;
  const body = JSON.stringify({ id, type: "webhook.test" });
  const signature = developerWebhookSignature(secret, id, timestamp, body);
  const input = { secret, eventId: id, timestamp, body, signature, now: timestamp };
  assert.equal(verifyDeveloperWebhook(input), true);
  for (const patch of [
    { body: body + " " },
    { eventId: endpoint.project_id },
    { timestamp: timestamp + 1 },
    { now: timestamp + 301 },
    { signature: "v1=" + "0".repeat(64) },
    { secret: developerWebhookSecret(master, { ...endpoint, generation: 2 }) },
  ])
    assert.equal(verifyDeveloperWebhook({ ...input, ...patch }), false);
});
