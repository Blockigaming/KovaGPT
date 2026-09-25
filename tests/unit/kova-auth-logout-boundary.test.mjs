import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { isCrossSiteMutation } from "../../src/lib/auth-security.mjs";

const source = await readFile(
  new URL("../../src/lib/kova-auth-http.server.ts", import.meta.url),
  "utf8",
);
const signature = "export async function handleKovaLogout(request: Request): Promise<Response>";
const start = source.indexOf(signature);
const end = source.indexOf("export async function handleKovaSession(", start);
assert.ok(start >= 0 && end > start, "The actual exported logout handler must be present");
assert.equal(source.indexOf(signature, start + signature.length), -1);
// Execute the actual handler body, not a rewritten behavioral model. This narrow
// signature erasure is deliberate: source-shape changes require a harness update.
const handlerSource = source
  .slice(start, end)
  .trim()
  .replace(signature, "async function handleKovaLogout(request)");

function harness(options = {}) {
  const events = [];
  const bindings = {
    Response,
    Error,
    console: { error() {} },
    isCrossSiteMutation,
    kovaModeAvailable: () => options.unavailable ?? null,
    readKovaSessionToken: () => {
      events.push("read-cookie");
      return Object.hasOwn(options, "credential")
        ? options.credential
        : { ok: true, token: "unit-test-opaque-token" };
    },
    digestKovaToken: (token) => {
      events.push("digest-token");
      assert.equal(token, "unit-test-opaque-token");
      return "unit-test-digest";
    },
    revokeSession: async (digest) => {
      events.push("revoke-session");
      assert.equal(digest, "unit-test-digest");
      if (options.revocationFails) throw new Error("simulated database outage");
    },
    jsonError: (error, status) =>
      Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
    noStoreHeaders: (extra) => {
      const headers = new Headers(extra);
      headers.set("Cache-Control", "no-store");
      headers.set("Pragma", "no-cache");
      headers.set("Referrer-Policy", "no-referrer");
      return headers;
    },
    clearKovaSessionCookie: () => {
      events.push("clear-cookie");
      return "__Host-kova_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
    },
  };
  return {
    events,
    handle: vm.runInNewContext(`(${handlerSource})`, bindings, { timeout: 1000 }),
  };
}

const origin = "https://auth.example.test";
function request(headers = {}, method = "POST") {
  return new Request(`${origin}/api/auth/logout`, { method, headers });
}

for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
  test(`logout rejects ${method} before reading or mutating the session`, async () => {
    const { handle, events } = harness();
    const response = await handle(request({ Origin: origin }, method));
    assert.equal(response.status, 405);
    assert.deepEqual(events, []);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

const forbiddenRequests = [
  ["cross-site origin", { Origin: "https://untrusted.invalid", "Sec-Fetch-Site": "cross-site" }],
  ["sibling subdomain", { Origin: "https://sibling.example.test", "Sec-Fetch-Site": "same-site" }],
  ["same-site metadata without Origin", { "Sec-Fetch-Site": "same-site" }],
  ["opaque origin", { Origin: "null" }],
  ["malformed origin", { Origin: "not a URL" }],
  [
    "mismatched origin despite same-origin metadata",
    { Origin: "https://sibling.example.test", "Sec-Fetch-Site": "same-origin" },
  ],
];
for (const [name, headers] of forbiddenRequests) {
  test(`logout rejects ${name} without revoking or clearing credentials`, async () => {
    const { handle, events } = harness();
    const response = await handle(request(headers));
    assert.equal(response.status, 403);
    assert.deepEqual(events, []);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("same-origin POST revokes exactly once before clearing the cookie", async () => {
  const { handle, events } = harness();
  const response = await handle(request({ Origin: origin, "Sec-Fetch-Site": "same-origin" }));
  assert.equal(response.status, 204);
  assert.deepEqual(events, ["read-cookie", "digest-token", "revoke-session", "clear-cookie"]);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

for (const credential of [null, { ok: false }]) {
  test(`same-origin logout clears a ${credential === null ? "missing" : "malformed"} cookie without revocation`, async () => {
    const { handle, events } = harness({ credential });
    const response = await handle(request({ Origin: origin }));
    assert.equal(response.status, 204);
    assert.deepEqual(events, ["read-cookie", "clear-cookie"]);
  });
}

test("failed revocation returns an error without claiming sign-out succeeded", async () => {
  const { handle, events } = harness({ revocationFails: true });
  const response = await handle(request({ Origin: origin }));
  assert.equal(response.status, 503);
  assert.deepEqual(events, ["read-cookie", "digest-token", "revoke-session"]);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("disabled Kova mode cannot read or revoke a session", async () => {
  const unavailable = new Response(null, { status: 404 });
  const { handle, events } = harness({ unavailable });
  const response = await handle(request({ Origin: origin }));
  assert.equal(response, unavailable);
  assert.deepEqual(events, []);
});
