import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("src/lib/kova-auth-http.server.ts", "utf8");
const signature = "export async function handleKovaSession(request: Request): Promise<Response>";
const start = source.indexOf(signature);
const end = source.indexOf("export async function handleKovaToken(", start);
assert.ok(start >= 0 && end > start);
const handler = source
  .slice(start, end)
  .trim()
  .replace(signature, "async function handleKovaSession(request)");
function fixture(status = 404, credential = { ok: true, token: "opaque-fixture" }) {
  const calls = [];
  const handle = vm.runInNewContext(`(${handler})`, {
    kovaModeAvailable: () => (status ? new Response(null, { status }) : null),
    json: (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } }),
    jsonError: (error, status) => Response.json({ error }, { status }),
    readKovaSessionToken: () => {
      calls.push("cookie");
      return credential;
    },
    digestKovaToken: (token) => token,
    resolveSession: async () => {
      calls.push("store");
      return { accountId: "fixture-owner" };
    },
    sessionResponse: (principal) => Response.json({ session: principal }),
  });
  return { calls, handle };
}
test("disabled owned auth gives old GET probes a no-store null authority without reading cookies or the database", async () => {
  const f = fixture();
  const response = await f.handle(
    new Request("https://kova.test/api/auth/session", {
      headers: { Cookie: "__Host-kova_session=stale-owned-cookie" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { session: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(f.calls, []);
});
for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
  test(`disabled owned session ${method} does not become a hosted-mode operation`, async () => {
    const f = fixture();
    assert.equal(
      (await f.handle(new Request("https://kova.test/api/auth/session", { method }))).status,
      404,
    );
    assert.deepEqual(f.calls, []);
  });
}
test("unavailable authority is never reported as a confirmed absent owned session", async () => {
  const f = fixture(503);
  assert.equal((await f.handle(new Request("https://kova.test/api/auth/session"))).status, 503);
  assert.deepEqual(f.calls, []);
});
test("enabled owned auth still validates its cookie against the session store", async () => {
  const f = fixture(0);
  const response = await f.handle(new Request("https://kova.test/api/auth/session"));
  assert.deepEqual(await response.json(), { session: { accountId: "fixture-owner" } });
  assert.deepEqual(f.calls, ["cookie", "store"]);
});
test("enabled owned auth still rejects an invalid cookie", async () => {
  const f = fixture(0, { ok: false });
  assert.equal((await f.handle(new Request("https://kova.test/api/auth/session"))).status, 401);
  assert.deepEqual(f.calls, ["cookie"]);
});
