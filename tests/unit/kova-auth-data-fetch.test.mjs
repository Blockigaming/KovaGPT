import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("src/lib/kova-auth-data-fetch.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ token = "fresh-jwt", status = 401, active = true, afterFirst } = {}) {
  const exports = {};
  const calls = [],
    state = { cleared: 0, refreshed: 0, active };
  vm.runInNewContext(code, {
    exports,
    Request,
    Response,
    URL,
    Headers,
    require: (name) => {
      assert.equal(name, "@/lib/kova-auth-browser");
      return {
        clearKovaAuthCache: () => {
          state.cleared++;
        },
        getKovaCompatibilityToken: async () => {
          state.refreshed++;
          return token;
        },
        isKovaSessionActive: () => state.active,
      };
    },
  });
  const dataFetch = exports.createKovaDataFetch(
    "https://data.example.invalid",
    async (input, init) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        afterFirst?.(state);
        return new Response("", { status });
      }
      return new Response("ok");
    },
  );
  return { dataFetch, calls, state };
}
const endpoint = "https://data.example.invalid/rest/v1/private_records";
const headers = { Authorization: "Bearer rejected-jwt", Accept: "application/json" };

for (const method of ["GET", "HEAD"]) {
  test(`${method}: a rejected cached token is discarded and the safe read is retried once`, async () => {
    const f = fixture();
    assert.equal((await f.dataFetch(endpoint, { method, headers })).status, 200);
    assert.equal(f.calls.length, 2);
    assert.equal(f.state.cleared, 1);
    assert.equal(f.state.refreshed, 1);
    assert.equal(new Headers(f.calls[1].init.headers).get("Authorization"), "Bearer fresh-jwt");
    assert.equal(new Headers(f.calls[1].init.headers).get("Accept"), "application/json");
    assert.equal(headers.Authorization, "Bearer rejected-jwt");
  });
}

for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  test(`${method}: clear the rejected JWT without replaying a mutation or reading its body`, async () => {
    const f = fixture();
    const init = { method, headers, body: '{"mutation":true}' };
    assert.equal((await f.dataFetch(endpoint, init)).status, 401);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init, init);
    assert.equal(f.state.cleared, 1);
    assert.equal(f.state.refreshed, 0);
  });
}

test("an expired/revoked cookie never falls back to hosted auth or replays a read anonymously", async () => {
  const f = fixture({ token: null });
  assert.equal((await f.dataFetch(endpoint, { headers })).status, 401);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.refreshed, 1);
});

test("401 handling never attaches a new bearer to other hosts or unrelated endpoint families", async () => {
  for (const url of [
    "https://untrusted.example/rest/v1/table",
    "https://data.example.invalid.evil/rest/v1/table",
    "https://data.example.invalid/auth/v1/token",
    "https://data.example.invalid/rest/v10/table",
  ]) {
    const f = fixture();
    assert.equal((await f.dataFetch(url, { headers })).status, 401);
    assert.equal(f.calls.length, 1);
    assert.equal(f.state.cleared, 0);
    assert.equal(f.state.refreshed, 0);
  }
});

test("non-authentication failures, anonymous requests and inactive Kova sessions are not retried", async () => {
  for (const status of [200, 403, 429, 500]) {
    const f = fixture({ status });
    assert.equal((await f.dataFetch(endpoint, { headers })).status, status);
    assert.equal(f.calls.length, 1);
    assert.equal(f.state.cleared, 0);
  }
  const anonymous = fixture();
  await anonymous.dataFetch(endpoint);
  assert.equal(anonymous.state.refreshed, 0);
  const hosted = fixture({ active: false });
  await hosted.dataFetch(endpoint, { headers });
  assert.equal(hosted.state.refreshed, 0);
  assert.equal(hosted.state.cleared, 0);
});

test("Request inputs preserve method, headers, URL and abort state", async () => {
  const f = fixture();
  const request = new Request(endpoint, { headers });
  await f.dataFetch(request);
  assert.equal(f.calls[1].input, request);
  assert.equal(f.calls[1].init.headers.get("Authorization"), "Bearer fresh-jwt");
  const abort = new AbortController();
  const aborted = fixture({ afterFirst: () => abort.abort() });
  assert.equal((await aborted.dataFetch(endpoint, { headers, signal: abort.signal })).status, 401);
  assert.equal(aborted.calls.length, 1);
  assert.equal(aborted.state.refreshed, 0);
});

test("logout while an authentication failure is in flight prevents any refresh retry", async () => {
  const f = fixture({
    afterFirst: (state) => {
      state.active = false;
    },
  });
  assert.equal((await f.dataFetch(endpoint, { headers })).status, 401);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.refreshed, 0);
});

test("the Kova data client installs this transport while keeping the legacy client unchanged", () => {
  const source = readFileSync("src/integrations/supabase/client.ts", "utf8");
  assert.match(
    source,
    /if \(kind === "kova"\)[\s\S]*accessToken: getKovaCompatibilityToken,[\s\S]*global: \{ fetch: createKovaDataFetch\(url\) \}/u,
  );
  assert.equal((source.match(/createKovaDataFetch\(url\)/gu) ?? []).length, 1);
});
