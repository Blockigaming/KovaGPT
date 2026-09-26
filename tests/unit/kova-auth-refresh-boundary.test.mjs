import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { isCrossSiteMutation } from "../../src/lib/auth-security.mjs";

const source = await readFile(
  new URL("../../src/lib/kova-auth-http.server.ts", import.meta.url),
  "utf8",
);
const signature = "export async function handleKovaRefresh(request: Request): Promise<Response>";
const start = source.indexOf(signature);
const end = source.indexOf("export async function handleKovaVerification(", start);
assert.ok(start >= 0 && end > start, "The actual exported refresh handler must be present");
assert.equal(source.indexOf(signature, start + signature.length), -1);
const handlerSource = source
  .slice(start, end)
  .trim()
  .replace(signature, "async function handleKovaRefresh(request)");

function harness(options = {}) {
  const events = [];
  const principal = { accountId: "fixture-account", sessionId: "fixture-session" };
  return {
    events,
    handle: vm.runInNewContext(
      `(${handlerSource})`,
      {
        Response,
        isCrossSiteMutation,
        isKovaCrossSiteMutation: (request) => isCrossSiteMutation(request, origin),
        kovaModeAvailable: () => options.unavailable ?? null,
        readKovaSessionToken: () => {
          events.push("read-cookie");
          return Object.hasOwn(options, "credential")
            ? options.credential
            : { ok: true, token: "old-opaque-token" };
        },
        generateKovaToken: () => {
          events.push("generate-token");
          return "new-opaque-token";
        },
        digestKovaToken: (token) => {
          events.push(`digest:${token}`);
          return `digest:${token}`;
        },
        KOVA_AUTH_SESSION_SECONDS: 2592000,
        futureIso: (seconds) => {
          assert.equal(seconds, 2592000);
          return "2026-10-23T17:00:00.000Z";
        },
        rotateSession: async (input) => {
          events.push("rotate-session");
          assert.deepEqual(JSON.parse(JSON.stringify(input)), {
            oldDigest: "digest:old-opaque-token",
            newDigest: "digest:new-opaque-token",
            expiresAt: "2026-10-23T17:00:00.000Z",
          });
          if (options.rotationFails) throw new Error("simulated store rejection");
          return principal;
        },
        sessionResponse: (value, token) => {
          events.push("set-cookie");
          assert.equal(value, principal);
          assert.equal(token, "new-opaque-token");
          return Response.json(
            { session: value },
            { headers: { "Cache-Control": "no-store", "Set-Cookie": "fixture-secure-cookie" } },
          );
        },
        jsonError: (error, status) =>
          Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
      },
      { timeout: 1000 },
    ),
  };
}

const origin = "https://auth.example.test";
function request(headers = {}, method = "POST") {
  return new Request(`${origin}/api/auth/refresh`, { method, headers });
}
for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
  test(`refresh rejects ${method} before cookie access or token rotation`, async () => {
    const h = harness();
    const response = await h.handle(request({ Origin: origin }, method));
    assert.equal(response.status, 405);
    assert.deepEqual(h.events, []);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}
for (const [name, headers] of [
  ["foreign origin", { Origin: "https://untrusted.invalid", "Sec-Fetch-Site": "cross-site" }],
  ["sibling origin", { Origin: "https://sibling.example.test", "Sec-Fetch-Site": "same-site" }],
  ["same-site metadata without Origin", { "Sec-Fetch-Site": "same-site" }],
  ["missing origin evidence", {}],
  ["opaque origin", { Origin: "null" }],
  ["malformed origin", { Origin: "not a URL" }],
  ["contradictory metadata", { Origin: origin, "Sec-Fetch-Site": "cross-site" }],
  [
    "forged same-origin metadata",
    { Origin: "https://sibling.example.test", "Sec-Fetch-Site": "same-origin" },
  ],
]) {
  test(`refresh rejects ${name} without reading, revoking or replacing the cookie`, async () => {
    const h = harness();
    const response = await h.handle(request(headers));
    assert.equal(response.status, 403);
    assert.deepEqual(h.events, []);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}
for (const headers of [{ Origin: origin }, { "Sec-Fetch-Site": "same-origin" }]) {
  test(`same-origin refresh rotates only the cookie credential: ${JSON.stringify(headers)}`, async () => {
    const h = harness();
    const response = await h.handle(request(headers));
    assert.equal(response.status, 200);
    assert.deepEqual(h.events, [
      "read-cookie",
      "generate-token",
      "digest:old-opaque-token",
      "digest:new-opaque-token",
      "rotate-session",
      "set-cookie",
    ]);
    assert.doesNotMatch(await response.text(), /opaque-token/u);
  });
}
for (const credential of [null, { ok: false }]) {
  test(`refresh rejects ${credential === null ? "missing" : "malformed"} cookie without rotating`, async () => {
    const h = harness({ credential });
    const response = await h.handle(request({ Origin: origin }));
    assert.equal(response.status, 401);
    assert.deepEqual(h.events, ["read-cookie"]);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}
test("revoked or stale session rotation cannot publish a replacement cookie", async () => {
  const h = harness({ rotationFails: true });
  const response = await h.handle(request({ Origin: origin }));
  assert.equal(response.status, 401);
  assert.equal(h.events.at(-1), "rotate-session");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.doesNotMatch(await response.text(), /simulated|opaque-token/u);
});
test("disabled owned mode cannot access or rotate a cookie", async () => {
  const unavailable = new Response(null, { status: 404 });
  const h = harness({ unavailable });
  assert.equal(await h.handle(request({ Origin: origin })), unavailable);
  assert.deepEqual(h.events, []);
});
